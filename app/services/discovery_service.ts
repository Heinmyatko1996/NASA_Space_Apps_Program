import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@adonisjs/core/logger'
import { LIST, VARCHAR, listValue } from '@duckdb/node-api'
import { CATALOG_QUERIES } from '#database/macro_scripts'
import { translateDiscoveryError } from '#exceptions/discovery_error'
import type DuckDbService from '#services/duckdb_service'
import type { QueryParams, QueryTypes } from '#services/duckdb_service'

/** Highest top-N a user can request; also how many ranks are cached. */
export const MAX_TOP_N = 25
export const DEFAULT_TOP_N = 10

/** Hein's baseline ranking uses this reference region and all features. */
export const BASELINE_REFERENCE_REGION = 'Atacama'

/**
 * A validated discovery request. `region` and `reference` are bare region
 * names as the macros expect them (`South_Pole`, `Atacama`), not the
 * catalog's `Moon:South_Pole` IDs.
 */
export interface DiscoveryConfig {
  world: string
  region: string
  reference: string
  features: string[]
  topN: number
}

export interface CatalogWorld {
  id: string
  label: string
  regionCount: number
}

export interface CatalogRegion {
  /** Catalog ID, e.g. `Moon:South_Pole`. */
  id: string
  worldId: string
  /** Bare region name for the macros, e.g. `South_Pole`. */
  region: string
  label: string
  role: 'target' | 'candidate'
  eligibleCellCount: number
}

export interface CatalogFeature {
  id: string
  label: string
  unit: string
  description: string
  defaultSelected: boolean
  sortOrder: number
}

export interface Catalog {
  worlds: CatalogWorld[]
  regions: CatalogRegion[]
  features: CatalogFeature[]
}

export interface ReferenceRegion {
  /** Catalog ID, e.g. `Earth:Atacama`. */
  id: string
  worldId: string
  /** Bare region name for the macros, e.g. `Atacama`. */
  region: string
  label: string
  eligibleCellCount: number
  gridResolutionM: number
}

export interface GeoPoint {
  latitude: number
  longitude: number
}

export interface TerrainValues {
  meanSlopeDeg: number
  robustReliefM: number
  slopeStddevDeg: number
}

/** Signed, in Earth-reference robust-scale units; NULL when not selected. */
export interface FeatureDifferences {
  meanSlopeZ: number | null
  robustReliefZ: number | null
  slopeVariabilityZ: number | null
}

export interface DiscoverySummary {
  targetPlanet: string
  targetRegion: string
  referenceRegion: string
  targetCellCount: number
  minBestDistance: number | null
  q25BestDistance: number | null
  medianBestDistance: number | null
  q75BestDistance: number | null
  maxBestDistance: number | null
  meanBestDistance: number | null
}

export interface CandidateDiversity {
  targetCellCount: number
  uniqueCandidateCount: number
  candidateDiversityPct: number | null
  maxCandidateReuseCount: number | null
  mostReusedCandidate: {
    cellId: string
    region: string
    count: number
    sharePct: number | null
  } | null
}

export interface RankedCandidate {
  rank: number
  /** Standardized Euclidean distance: lower is closer, not a percentage. */
  distance: number
  cellId: string
  region: string
  location: GeoPoint
  terrain: TerrainValues
  featureDifferences: FeatureDifferences
}

export interface CellCandidates {
  target: {
    cellId: string
    planet: string
    region: string
    location: GeoPoint
    terrain: TerrainValues
  }
  candidates: RankedCandidate[]
}

export interface GridCell {
  cellId: string
  gridRow: number
  gridCol: number
  location: GeoPoint
  /** At least 95% DEM and slope coverage; only these cells are ranked. */
  eligible: boolean
  validPixelFraction: number
  validSlopePixelFraction: number
  bestEarthCellId: string | null
  bestDistance: number | null
}

export interface DiscoveryRun {
  configuration: DiscoveryConfig
  summary: DiscoverySummary
  diversity: CandidateDiversity
  cells: GridCell[]
  /** The eligible target cell with the lowest best-match distance. */
  bestCellId: string | null
  timing: {
    /**
     * Time this request spent on the ranking: running run_discovery, or
     * waiting for a concurrent request that is running it. 0 when cached.
     */
    rankingMs: number
    /** The ranking was already in discovery_cache when the request arrived. */
    rankingCached: boolean
    totalMs: number
  }
}

export interface BaselineExample {
  world: string
  region: string
  reference: string
  summary: DiscoverySummary
  diversity: CandidateDiversity
  featured: CellCandidates | null
}

/** Shape from docs/api/candidate_details_response.md (Hein's contract). */
export interface CandidateDetails {
  target: CellDetail
  candidate: CellDetail
  comparison: {
    rank: number
    distance: number
    featureDifferences: FeatureDifferences
  }
  configuration: {
    referenceRegion: string
    selectedFeatures: string[]
  }
}

export interface CellDetail {
  cellId: string
  planet: string
  region: string
  location: GeoPoint
  terrain: TerrainValues & { meanElevationM: number }
  dataQuality: {
    validPixelFraction: number
    validSlopePixelFraction: number
  }
}

export interface RegionExtent {
  minLatitude: number
  maxLatitude: number
  minLongitude: number
  maxLongitude: number
  cellCount: number
}

type Row = Record<string, any>

/** `features` is always bound as a VARCHAR list, even when empty. */
const FEATURE_TYPES: QueryTypes = { features: LIST(VARCHAR) }

/**
 * Calls Hein's TerraTwin macros (queries/) and the app macros
 * (database/app_macros.sql) and returns view-ready objects.
 *
 * Register it as a container singleton: it holds the cached catalog and
 * remembers which configurations are already in `discovery_cache`.
 *
 * Every value is bound as a parameter, never concatenated into SQL. Errors
 * that run_discovery raises for bad input become 422 validation errors.
 */
export default class DiscoveryService {
  #catalog: Promise<Catalog> | null = null
  #referenceRegions: Promise<ReferenceRegion[]> | null = null

  /** Configuration key → the INSERT that fills discovery_cache for it. */
  #rankings = new Map<string, { insert: Promise<void>; done: boolean }>()

  /** `planet|region` → bounding box; the data cannot change while running. */
  #extents = new Map<string, Promise<RegionExtent | null>>()

  constructor(
    private db: DuckDbService,
    private logger: Logger,
    /** Directory that holds queries/ (the app root). */
    private appRoot: string
  ) {}

  /**
   * Target worlds, their regions, Earth reference regions, and selectable
   * features, from Hein's get_catalog.sql. Loaded once, on first use.
   */
  catalog(): Promise<Catalog> {
    this.#catalog ??= this.#loadCatalog().catch((error) => {
      this.#catalog = null
      throw error
    })
    return this.#catalog
  }

  /** Earth reference regions, from Hein's get_reference_regions.sql. */
  referenceRegions(): Promise<ReferenceRegion[]> {
    this.#referenceRegions ??= this.#loadReferenceRegions().catch((error) => {
      this.#referenceRegions = null
      throw error
    })
    return this.#referenceRegions
  }

  /**
   * Explore card for one target region: Hein's precomputed baseline summary
   * and diversity, plus the top candidates of the target cell with the
   * closest best match.
   */
  async baseline(
    world: string,
    region: string,
    reference = BASELINE_REFERENCE_REGION,
    topN = 3
  ): Promise<BaselineExample> {
    const params = { world, region, reference }
    const [summary, diversity, featuredCell] = await Promise.all([
      this.#first(
        `SELECT * REPLACE (target_cell_count::INTEGER AS target_cell_count)
         FROM get_discovery_summary($world, $region, $reference)`,
        params
      ),
      this.#first(`SELECT * FROM get_candidate_diversity($world, $region, $reference)`, params),
      this.#first(`SELECT * FROM featured_target_cell($world, $region, $reference)`, params),
    ])

    let featured: CellCandidates | null = null
    if (featuredCell) {
      const rows = await this.#all(
        `SELECT * REPLACE (rank::INTEGER AS rank)
         FROM get_ranked_candidates($world, $region, $cellId, $reference, $topN::INTEGER)`,
        { ...params, cellId: featuredCell.target_cell_id, topN }
      )
      featured = toCellCandidates(rows)
    }

    return {
      world,
      region,
      reference,
      summary: toSummary(summary, params),
      diversity: toDiversity(diversity),
      featured,
    }
  }

  /**
   * Runs a custom discovery: summary, diversity, and the target cell grid
   * colored by best-match distance. The ranking itself runs once per
   * configuration (see database/app_macros.sql); later calls reuse it.
   */
  async run(config: DiscoveryConfig): Promise<DiscoveryRun> {
    const startedAt = performance.now()
    const { ms: rankingMs, cached: rankingCached } = await this.#ensureRanked(config)
    const params = configParams(config)

    const [summary, diversity, cellRows] = await Promise.all([
      this.#first(
        `SELECT * REPLACE (target_cell_count::INTEGER AS target_cell_count)
         FROM custom_discovery_summary($world, $region, $reference, $features)`,
        params
      ),
      this.#first(
        `SELECT * FROM custom_candidate_diversity($world, $region, $reference, $features)`,
        params
      ),
      this.#all(`SELECT * FROM target_cell_grid($world, $region, $reference, $features)`, params),
    ])

    const cells = cellRows.map(toGridCell)
    const best = cells
      .filter((cell) => cell.bestDistance !== null)
      .reduce<GridCell | null>(
        (closest, cell) =>
          closest === null || cell.bestDistance! < closest.bestDistance! ? cell : closest,
        null
      )

    const totalMs = Math.round(performance.now() - startedAt)
    this.logger.info(
      { configuration: config, rankingMs, rankingCached, totalMs },
      'Discovery ran in %d ms',
      totalMs
    )

    return {
      configuration: config,
      summary: toSummary(summary, params),
      diversity: toDiversity(diversity),
      cells,
      bestCellId: best?.cellId ?? null,
      timing: { rankingMs, rankingCached, totalMs },
    }
  }

  /**
   * Ranked Earth candidates (up to `config.topN`) for one target cell, or
   * null when the cell is not an eligible cell of the configured region.
   */
  async cellCandidates(config: DiscoveryConfig, cellId: string): Promise<CellCandidates | null> {
    await this.#ensureRanked(config)
    const rows = await this.#all(
      `SELECT * REPLACE (rank::INTEGER AS rank)
       FROM cell_candidates($world, $region, $cellId, $reference, $features, $topN::INTEGER)`,
      { ...configParams(config), cellId, topN: config.topN }
    )
    return toCellCandidates(rows)
  }

  /**
   * Full comparison of one target cell and its Earth candidate at `rank`,
   * from Hein's get_candidate_details, in the JSON shape of
   * docs/api/candidate_details_response.md. Null when there is no such
   * candidate.
   */
  async candidateDetails(
    config: DiscoveryConfig,
    cellId: string,
    rank: number
  ): Promise<CandidateDetails | null> {
    const row = await this.#first(
      `SELECT * REPLACE (rank::INTEGER AS rank)
       FROM get_candidate_details($world, $region, $cellId, $reference, $features, $rank::INTEGER)`,
      { ...configParams(config), cellId, rank }
    )
    return row ? toCandidateDetails(row, config) : null
  }

  /** Bounding box of a region's cells, for map insets. Cached per region. */
  regionExtent(planet: string, region: string): Promise<RegionExtent | null> {
    const key = `${planet}|${region}`
    let extent = this.#extents.get(key)
    if (!extent) {
      extent = this.#loadRegionExtent(planet, region).catch((error) => {
        this.#extents.delete(key)
        throw error
      })
      this.#extents.set(key, extent)
    }
    return extent
  }

  async #loadRegionExtent(planet: string, region: string): Promise<RegionExtent | null> {
    const row = await this.#first(
      `SELECT * REPLACE (cell_count::INTEGER AS cell_count) FROM region_extent($planet, $region)`,
      { planet, region }
    )
    if (!row || row.cell_count === 0) {
      return null
    }
    return {
      minLatitude: row.min_latitude,
      maxLatitude: row.max_latitude,
      minLongitude: row.min_longitude,
      maxLongitude: row.max_longitude,
      cellCount: row.cell_count,
    }
  }

  /**
   * Makes sure discovery_cache holds the ranking for this configuration,
   * running run_discovery once if needed. Concurrent requests for the same
   * configuration share one INSERT. A failed INSERT is forgotten, so the
   * next request retries.
   */
  async #ensureRanked(config: DiscoveryConfig): Promise<{ ms: number; cached: boolean }> {
    const key = configKey(config)
    let ranking = this.#rankings.get(key)
    if (ranking?.done) {
      return { ms: 0, cached: true }
    }

    const startedAt = performance.now()
    if (!ranking) {
      const entry = {
        done: false,
        insert: this.db
          .run(
            `INSERT INTO discovery_cache BY NAME
             SELECT discovery_config_key($world, $region, $reference, $features) AS config_key, *
             FROM run_discovery($world, $region, $reference, $features, $maxTopN::INTEGER)`,
            { ...configParams(config), maxTopN: MAX_TOP_N },
            FEATURE_TYPES
          )
          .then(
            () => {
              entry.done = true
            },
            (error) => {
              this.#rankings.delete(key)
              throw translateDiscoveryError(error)
            }
          ),
      }
      ranking = entry
      this.#rankings.set(key, entry)
    }

    await ranking.insert
    return { ms: Math.round(performance.now() - startedAt), cached: false }
  }

  async #loadCatalog(): Promise<Catalog> {
    const rows = await this.db.all<Row>(await this.#readQuery(CATALOG_QUERIES.catalog))
    return {
      worlds: rows
        .filter((row) => row.item_type === 'world')
        .map((row) => ({
          id: row.world_id,
          label: row.world_label,
          regionCount: Number(row.region_count),
        })),
      regions: rows
        .filter((row) => row.item_type === 'region')
        .map((row) => ({
          id: row.region_id,
          worldId: row.world_id,
          region: bareRegion(row.region_id, row.world_id),
          label: row.region_label,
          role: row.region_role,
          eligibleCellCount: Number(row.eligible_cell_count),
        })),
      features: rows
        .filter((row) => row.item_type === 'feature')
        .map((row) => ({
          id: row.feature_id,
          label: row.feature_label,
          unit: row.unit,
          description: row.description,
          defaultSelected: Boolean(row.default_selected),
          sortOrder: Number(row.sort_order),
        })),
    }
  }

  async #loadReferenceRegions(): Promise<ReferenceRegion[]> {
    const rows = await this.db.all<Row>(await this.#readQuery(CATALOG_QUERIES.referenceRegions))
    return rows.map((row) => ({
      id: row.reference_id,
      worldId: row.reference_world_id,
      region: row.reference_region_id,
      label: row.reference_region_label,
      eligibleCellCount: Number(row.eligible_cell_count),
      gridResolutionM: Number(row.feature_grid_resolution_m),
    }))
  }

  #readQuery(path: string) {
    return readFile(join(this.appRoot, path), 'utf8')
  }

  async #all(sql: string, params: QueryParams): Promise<Row[]> {
    const types = 'features' in params ? FEATURE_TYPES : undefined
    try {
      return await this.db.all<Row>(sql, params, types)
    } catch (error) {
      throw translateDiscoveryError(error)
    }
  }

  async #first(sql: string, params: QueryParams): Promise<Row | null> {
    const rows = await this.#all(sql, params)
    return rows[0] ?? null
  }
}

/** `Moon:South_Pole` → `South_Pole`. */
function bareRegion(regionId: string, worldId: string) {
  const prefix = `${worldId}:`
  return regionId.startsWith(prefix) ? regionId.slice(prefix.length) : regionId
}

/** Feature order does not change a distance, so it does not change the key. */
function configKey(config: DiscoveryConfig) {
  return [
    config.world,
    config.region,
    config.reference,
    [...config.features].sort().join(','),
  ].join('|')
}

function configParams(config: DiscoveryConfig) {
  return {
    world: config.world,
    region: config.region,
    reference: config.reference,
    features: listValue(config.features),
  }
}

function toSummary(
  row: Row | null,
  params: { world: string; region: string; reference: string }
): DiscoverySummary {
  return {
    targetPlanet: row?.target_planet ?? params.world,
    targetRegion: row?.target_region ?? params.region,
    referenceRegion: row?.reference_region ?? params.reference,
    targetCellCount: row?.target_cell_count ?? 0,
    minBestDistance: row?.min_best_distance ?? null,
    q25BestDistance: row?.q25_best_distance ?? null,
    medianBestDistance: row?.median_best_distance ?? null,
    q75BestDistance: row?.q75_best_distance ?? null,
    maxBestDistance: row?.max_best_distance ?? null,
    meanBestDistance: row?.mean_best_distance ?? null,
  }
}

/** BIGINT (or missing) → number | null. */
function optionalNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function toDiversity(row: Row | null): CandidateDiversity {
  return {
    targetCellCount: Number(row?.target_cell_count ?? 0),
    uniqueCandidateCount: Number(row?.unique_candidate_count ?? 0),
    candidateDiversityPct: row?.candidate_diversity_pct ?? null,
    maxCandidateReuseCount: optionalNumber(row?.max_candidate_reuse_count),
    mostReusedCandidate: row?.most_reused_candidate_cell_id
      ? {
          cellId: row.most_reused_candidate_cell_id,
          region: row.most_reused_candidate_region,
          count: Number(row.most_reused_candidate_count),
          sharePct: row.most_reused_candidate_share_pct ?? null,
        }
      : null,
  }
}

function toFeatureDifferences(row: Row): FeatureDifferences {
  return {
    meanSlopeZ: row.slope_difference_z ?? null,
    robustReliefZ: row.relief_difference_z ?? null,
    slopeVariabilityZ: row.variability_difference_z ?? null,
  }
}

/** Rows from get_ranked_candidates or cell_candidates (same columns). */
function toCellCandidates(rows: Row[]): CellCandidates | null {
  const first = rows[0]
  if (!first) {
    return null
  }
  return {
    target: {
      cellId: first.target_cell_id,
      planet: first.target_planet,
      region: first.target_region,
      location: { latitude: first.target_latitude, longitude: first.target_longitude },
      terrain: {
        meanSlopeDeg: first.target_mean_slope_deg,
        robustReliefM: first.target_robust_relief_m,
        slopeStddevDeg: first.target_slope_stddev_deg,
      },
    },
    candidates: rows.map((row) => ({
      rank: row.rank,
      distance: row.distance,
      cellId: row.candidate_cell_id,
      region: row.reference_region,
      location: { latitude: row.candidate_latitude, longitude: row.candidate_longitude },
      terrain: {
        meanSlopeDeg: row.candidate_mean_slope_deg,
        robustReliefM: row.candidate_robust_relief_m,
        slopeStddevDeg: row.candidate_slope_stddev_deg,
      },
      featureDifferences: toFeatureDifferences(row),
    })),
  }
}

function toGridCell(row: Row): GridCell {
  return {
    cellId: row.cell_id,
    gridRow: row.grid_row,
    gridCol: row.grid_col,
    location: { latitude: row.latitude, longitude: row.longitude },
    eligible: Boolean(row.eligible),
    validPixelFraction: row.valid_pixel_fraction,
    validSlopePixelFraction: row.valid_slope_pixel_fraction,
    bestEarthCellId: row.best_earth_cell_id ?? null,
    bestDistance: row.best_distance ?? null,
  }
}

function toCandidateDetails(row: Row, config: DiscoveryConfig): CandidateDetails {
  const cell = (prefix: 'target' | 'earth', cellId: string, planet: string, region: string) => ({
    cellId,
    planet,
    region,
    location: { latitude: row[`${prefix}_latitude`], longitude: row[`${prefix}_longitude`] },
    terrain: {
      meanElevationM: row[`${prefix}_mean_elevation_m`],
      meanSlopeDeg: row[`${prefix}_mean_slope_deg`],
      robustReliefM: row[`${prefix}_robust_relief_m`],
      slopeStddevDeg: row[`${prefix}_slope_stddev_deg`],
    },
    dataQuality: {
      validPixelFraction: row[`${prefix}_valid_pixel_fraction`],
      validSlopePixelFraction: row[`${prefix}_valid_slope_pixel_fraction`],
    },
  })

  return {
    target: cell('target', row.target_cell_id, row.target_planet, row.target_region),
    candidate: cell('earth', row.earth_cell_id, 'Earth', row.earth_region),
    comparison: {
      rank: row.rank,
      distance: row.distance,
      featureDifferences: toFeatureDifferences(row),
    },
    configuration: {
      referenceRegion: config.reference,
      selectedFeatures: config.features,
    },
  }
}
