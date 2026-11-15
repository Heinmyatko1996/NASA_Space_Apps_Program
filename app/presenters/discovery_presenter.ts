import {
  DEFAULT_TOP_N,
  MAX_TOP_N,
  type BaselineExample,
  type Catalog,
  type CellCandidates,
  type DiscoveryConfig,
  type DiscoveryRun,
  type FeatureDifferences,
  type GeoPoint,
  type GridCell,
  type ReferenceRegion,
  type TerrainValues,
} from '#services/discovery_service'

/**
 * Turns DiscoveryService results into plain view data for the Edge
 * templates: labels, formatted numbers, URLs, grid positions, and bar
 * widths. Templates only print what this module prepares.
 *
 * Wording rules from plan.md: a distance is "lower = closer" and never a
 * percentage; feature differences are signed (positive = target higher).
 */

/** How each catalog feature maps onto the service's terrain and z fields. */
const FEATURES: Record<
  string,
  { z: keyof FeatureDifferences; terrain: keyof TerrainValues; digits: number; suffix: string }
> = {
  mean_slope_deg: { z: 'meanSlopeZ', terrain: 'meanSlopeDeg', digits: 1, suffix: '°' },
  robust_relief_m: { z: 'robustReliefZ', terrain: 'robustReliefM', digits: 0, suffix: ' m' },
  slope_stddev_deg: { z: 'slopeVariabilityZ', terrain: 'slopeStddevDeg', digits: 1, suffix: '°' },
}

/** Quick presets: they only set feature checkboxes. */
const PRESETS = [
  {
    id: 'baseline',
    label: 'Full terrain (baseline)',
    features: ['mean_slope_deg', 'robust_relief_m', 'slope_stddev_deg'],
  },
  { id: 'rover', label: 'Rover traverse', features: ['mean_slope_deg', 'slope_stddev_deg'] },
  { id: 'landing', label: 'Landing zone survey', features: ['mean_slope_deg'] },
]

/** Quartile bands of best-match distance within one run (1 = closest). */
const BANDS = [
  { band: 1, label: 'Closest 25%' },
  { band: 2, label: '25–50%' },
  { band: 3, label: '50–75%' },
  { band: 4, label: 'Farthest 25%' },
] as const

type Band = 1 | 2 | 3 | 4

// ---------------------------------------------------------------- formatting

export function formatDistance(distance: number | null | undefined): string {
  return distance === null || distance === undefined ? '—' : distance.toFixed(2)
}

function formatSigned(value: number): string {
  const rounded = value.toFixed(2)
  return value > 0 ? `+${rounded}` : rounded === '-0.00' ? '0.00' : rounded
}

function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`
}

export function formatCoordinates(point: GeoPoint): string {
  const lat = `${Math.abs(point.latitude).toFixed(2)}° ${point.latitude < 0 ? 'S' : 'N'}`
  const lon = `${Math.abs(point.longitude).toFixed(2)}° ${point.longitude < 0 ? 'W' : 'E'}`
  return `${lat}, ${lon}`
}

function formatTerrain(featureId: string, terrain: TerrainValues): string {
  const feature = FEATURES[featureId]
  return feature ? `${terrain[feature.terrain].toFixed(feature.digits)}${feature.suffix}` : '—'
}

// ---------------------------------------------------------------- labels

function worldLabel(catalog: Catalog, world: string) {
  return catalog.worlds.find((entry) => entry.id === world)?.label ?? world
}

function regionLabel(catalog: Catalog, world: string, region: string) {
  return (
    catalog.regions.find((entry) => entry.worldId === world && entry.region === region)?.label ??
    region.replaceAll('_', ' ')
  )
}

function referenceLabel(references: ReferenceRegion[], region: string) {
  return references.find((entry) => entry.region === region)?.label ?? region
}

function featureLabel(catalog: Catalog, featureId: string) {
  return catalog.features.find((feature) => feature.id === featureId)?.label ?? featureId
}

// ---------------------------------------------------------------- URLs

/** Query string for a configuration; repeated `features[]` keys. */
export function configQuery(config: DiscoveryConfig): string {
  const params = new URLSearchParams()
  params.set('world', config.world)
  params.set('region', config.region)
  params.set('reference', config.reference)
  for (const feature of config.features) {
    params.append('features[]', feature)
  }
  params.set('topN', String(config.topN))
  return params.toString()
}

/**
 * Page URL that selects one target cell (works without JavaScript). The
 * script builds the matching partial URL from the results' data-query.
 */
function cellHref(config: DiscoveryConfig, cellId: string) {
  return `/?${configQuery(config)}&cell=${encodeURIComponent(cellId)}`
}

// ---------------------------------------------------------------- form

export function defaultConfig(catalog: Catalog, references: ReferenceRegion[]): DiscoveryConfig {
  const world = catalog.worlds[0]?.id ?? 'Moon'
  return {
    world,
    region: targetRegions(catalog, world)[0]?.region ?? '',
    reference: references[0]?.region ?? '',
    features: catalog.features
      .filter((feature) => feature.defaultSelected)
      .map((feature) => feature.id),
    topN: DEFAULT_TOP_N,
  }
}

function targetRegions(catalog: Catalog, world: string) {
  return catalog.regions.filter((region) => region.role === 'target' && region.worldId === world)
}

/** Region radios for one world; the selected region, or the first one. */
export function regionOptions(catalog: Catalog, world: string, selected?: string) {
  const regions = targetRegions(catalog, world)
  const checked = regions.some((region) => region.region === selected)
    ? selected
    : regions[0]?.region
  return regions.map((region) => ({
    region: region.region,
    label: region.label,
    eligibleCellCount: region.eligibleCellCount,
    checked: region.region === checked,
  }))
}

export function formState(
  config: DiscoveryConfig,
  catalog: Catalog,
  references: ReferenceRegion[]
) {
  const featureIds = new Set(catalog.features.map((feature) => feature.id))
  return {
    topN: config.topN,
    maxTopN: MAX_TOP_N,
    worlds: catalog.worlds.map((world) => ({
      id: world.id,
      label: world.label,
      checked: world.id === config.world,
    })),
    regions: regionOptions(catalog, config.world, config.region),
    references: references.map((reference) => ({
      region: reference.region,
      label: reference.label,
      eligibleCellCount: reference.eligibleCellCount,
      selected: reference.region === config.reference,
    })),
    singleReference: references.length === 1,
    features: catalog.features.map((feature) => ({
      id: feature.id,
      label: feature.label,
      unit: feature.unit,
      description: feature.description,
      checked: config.features.includes(feature.id),
    })),
    presets: PRESETS.filter((preset) => preset.features.every((id) => featureIds.has(id))),
  }
}

// ---------------------------------------------------------------- results

function configurationLine(
  config: DiscoveryConfig,
  catalog: Catalog,
  references: ReferenceRegion[]
) {
  return {
    target: `${worldLabel(catalog, config.world)} · ${regionLabel(catalog, config.world, config.region)}`,
    reference: `Earth · ${referenceLabel(references, config.reference)}`,
    features: config.features.map((id) => featureLabel(catalog, id)),
    topN: config.topN,
  }
}

function bandFor(distance: number, run: Pick<DiscoveryRun, 'summary'>): Band {
  const { q25BestDistance: q25, medianBestDistance: median, q75BestDistance: q75 } = run.summary
  if (q25 !== null && distance <= q25) return 1
  if (median !== null && distance <= median) return 2
  if (q75 !== null && distance <= q75) return 3
  return 4
}

/**
 * Lays the target cells out on a CSS grid. Rows are flipped when latitude
 * grows with grid_row, so north is up. Grid indexes can be negative
 * (`…_r-7_c-3`), so they are offset to start at 1.
 */
function presentGrid(run: DiscoveryRun) {
  const cells = run.cells
  if (cells.length === 0) {
    return { columns: 0, rows: 0, cells: [], legend: [], closest: [] }
  }

  const minRow = Math.min(...cells.map((cell) => cell.gridRow))
  const maxRow = Math.max(...cells.map((cell) => cell.gridRow))
  const minCol = Math.min(...cells.map((cell) => cell.gridCol))
  const maxCol = Math.max(...cells.map((cell) => cell.gridCol))
  const meanLatitude = (row: number) => {
    const inRow = cells.filter((cell) => cell.gridRow === row)
    return inRow.reduce((sum, cell) => sum + cell.location.latitude, 0) / inRow.length
  }
  const flip = meanLatitude(minRow) < meanLatitude(maxRow)

  const view = (cell: GridCell) => {
    const band = cell.bestDistance === null ? null : bandFor(cell.bestDistance, run)
    const bandLabel = band ? BANDS[band - 1].label : null
    return {
      cellId: cell.cellId,
      row: flip ? maxRow - cell.gridRow + 1 : cell.gridRow - minRow + 1,
      col: cell.gridCol - minCol + 1,
      eligible: cell.eligible,
      band,
      distance: cell.bestDistance,
      distanceText: formatDistance(cell.bestDistance),
      bandLabel,
      bestEarthCellId: cell.bestEarthCellId,
      coordinates: formatCoordinates(cell.location),
      label: band
        ? `${cell.cellId}: best distance ${formatDistance(cell.bestDistance)} (${bandLabel} in this run)`
        : `${cell.cellId}: excluded, less than 95% data coverage`,
      href: cellHref(run.configuration, cell.cellId),
    }
  }

  const cellViews = cells.map(view)
  return {
    columns: maxCol - minCol + 1,
    rows: maxRow - minRow + 1,
    cells: cellViews,
    legend: BANDS.map(({ band, label }) => ({ band, label })),
    closest: cellViews
      .filter((cell) => cell.distance !== null)
      .sort((a, b) => a.distance! - b.distance!)
      .slice(0, 10),
  }
}

export function presentRun(run: DiscoveryRun, catalog: Catalog, references: ReferenceRegion[]) {
  const { summary, diversity, timing } = run
  return {
    query: configQuery(run.configuration),
    configuration: configurationLine(run.configuration, catalog, references),
    bestCellId: run.bestCellId,
    summary: {
      targetCellCount: summary.targetCellCount,
      median: formatDistance(summary.medianBestDistance),
      min: formatDistance(summary.minBestDistance),
      max: formatDistance(summary.maxBestDistance),
      q25: formatDistance(summary.q25BestDistance),
      q75: formatDistance(summary.q75BestDistance),
    },
    diversity: {
      pct: formatPct(diversity.candidateDiversityPct),
      uniqueCount: diversity.uniqueCandidateCount,
      targetCount: diversity.targetCellCount,
      mostReused: diversity.mostReusedCandidate
        ? {
            cellId: diversity.mostReusedCandidate.cellId,
            count: diversity.mostReusedCandidate.count,
            share: formatPct(diversity.mostReusedCandidate.sharePct),
          }
        : null,
    },
    timing: timing.rankingCached
      ? `Ranking reused from cache · ${timing.totalMs} ms`
      : `Ranked in ${timing.rankingMs} ms · ${timing.totalMs} ms total`,
    grid: presentGrid(run),
  }
}

/**
 * Candidate cards for one target cell. Each selected feature gets a bar
 * centered on zero: right when the target is higher than the Earth cell,
 * left when lower, with length relative to the largest difference shown.
 */
export function presentCellCandidates(
  result: CellCandidates,
  config: DiscoveryConfig,
  catalog: Catalog
) {
  const selected = config.features.filter((id) => FEATURES[id])
  const zOf = (differences: FeatureDifferences, id: string) => differences[FEATURES[id].z]

  const largest = Math.max(
    0,
    ...result.candidates.flatMap((candidate) =>
      selected.map((id) => Math.abs(zOf(candidate.featureDifferences, id) ?? 0))
    )
  )
  const scale = largest <= 1 ? 1 : Math.ceil(largest)

  const terrainRows = (terrain: TerrainValues) =>
    catalog.features
      .filter((feature) => FEATURES[feature.id])
      .map((feature) => ({
        label: feature.label,
        value: formatTerrain(feature.id, terrain),
        selected: config.features.includes(feature.id),
      }))

  return {
    target: {
      cellId: result.target.cellId,
      title: `${worldLabel(catalog, result.target.planet)} · ${regionLabel(catalog, result.target.planet, result.target.region)}`,
      coordinates: formatCoordinates(result.target.location),
      terrain: terrainRows(result.target.terrain),
    },
    scale,
    candidates: result.candidates.map((candidate) => ({
      rank: candidate.rank,
      cellId: candidate.cellId,
      region: candidate.region,
      coordinates: formatCoordinates(candidate.location),
      distance: formatDistance(candidate.distance),
      bars: selected.map((id) => {
        const z = zOf(candidate.featureDifferences, id) ?? 0
        const direction = Math.abs(z) < 0.005 ? 'same' : z > 0 ? 'higher' : 'lower'
        return {
          label: featureLabel(catalog, id),
          z: formatSigned(z),
          direction,
          widthPct: Math.round(Math.min(Math.abs(z) / scale, 1) * 1000) / 10,
          detail:
            direction === 'same'
              ? `about the same (target ${formatTerrain(id, result.target.terrain)}, Earth ${formatTerrain(id, candidate.terrain)})`
              : `target ${direction} (${formatTerrain(id, result.target.terrain)} vs ${formatTerrain(id, candidate.terrain)})`,
        }
      }),
    })),
  }
}

export function presentBaseline(example: BaselineExample, catalog: Catalog) {
  const { summary, diversity, featured } = example
  return {
    world: example.world,
    region: example.region,
    title: `${worldLabel(catalog, example.world)} · ${regionLabel(catalog, example.world, example.region)}`,
    reference: example.reference,
    targetCellCount: summary.targetCellCount,
    median: formatDistance(summary.medianBestDistance),
    min: formatDistance(summary.minBestDistance),
    max: formatDistance(summary.maxBestDistance),
    diversity: formatPct(diversity.candidateDiversityPct),
    featured: featured
      ? {
          cellId: featured.target.cellId,
          candidates: featured.candidates.map((candidate) => ({
            rank: candidate.rank,
            cellId: candidate.cellId,
            distance: formatDistance(candidate.distance),
          })),
        }
      : null,
  }
}
