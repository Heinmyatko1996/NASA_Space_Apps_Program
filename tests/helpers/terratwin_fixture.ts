import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'

/**
 * Synthetic stand-ins for the three Parquet files Hein's pipeline writes to
 * `data/processed/parquet/`. They have the same file names and the columns
 * the TerraTwin macros read, and roughly the real cell counts, so the real
 * SQL in `queries/` runs against them unchanged.
 *
 * Values are deterministic (hashed from each cell ID), not real terrain.
 * About 1 in 6 cells is below the 95% coverage threshold, so eligibility
 * filtering is exercised too.
 *
 * The baseline rankings file is produced by Hein's own `run_discovery` with
 * all three features, which is how the precomputed baseline is defined.
 */

export const FIXTURE_PARQUET_DIR = 'data/processed/parquet'

const ALL_FEATURES = "['mean_slope_deg', 'robust_relief_m', 'slope_stddev_deg']"

/**
 * One row per region: grid index range (inclusive, may be negative like the
 * real `…_r-7_c-3` IDs), anchor coordinates, degrees per grid step, and
 * value ranges per feature.
 */
const REGIONS_SQL = `
  CREATE TABLE fixture_regions AS
  SELECT * FROM (VALUES
    ('Earth', 'Atacama',    'earth_atacama_atacama', -10, 10, -23.80, -69.60, 0.045, 0.049, 1800.0,  1.0, 25.0,  50.0,  900.0),
    ('Moon',  'South_Pole', 'moon_south_south_pole',   0, 19, -87.90,  20.00, 0.050, 0.900, -2400.0, 3.0, 25.0, 100.0, 1200.0),
    ('Mars',  'Jezero',     'mars_jezero_jezero',      0, 20,  18.90,  77.10, 0.085, 0.090, -2600.0, 1.0, 15.0,  20.0,  500.0)
  ) AS r(
    planet, region, prefix, min_idx, max_idx, lat0, lon0, dlat, dlon,
    elevation0, slope_min, slope_span, relief_min, relief_span
  )
`

/** A deterministic number in [0, 1) for a cell and a salt. */
const unit = (salt: string) => `((hash(cell_id || '${salt}') % 100000) / 100000.0)`

const TERRAIN_SQL = `
  CREATE TABLE fixture_terrain AS
  WITH cells AS (
    SELECT
      r.*,
      g_row AS grid_row,
      g_col AS grid_col,
      r.prefix || '_r' || g_row || '_c' || g_col AS cell_id
    FROM fixture_regions r,
      range(r.min_idx, r.max_idx + 1) AS rows(g_row),
      range(r.min_idx, r.max_idx + 1) AS cols(g_col)
  )
  SELECT
    planet,
    region,
    cell_id,
    grid_col::INTEGER AS grid_col,
    grid_row::INTEGER AS grid_row,
    lon0 + grid_col * dlon AS longitude_center,
    lat0 - grid_row * dlat AS latitude_center,
    elevation0 + ${unit('elevation')} * 500 AS mean_elevation_m,
    relief_min + ${unit('relief')} * relief_span AS robust_relief_m,
    slope_min + ${unit('slope')} * slope_span AS mean_slope_deg,
    0.5 + ${unit('variability')} * 8 AS slope_stddev_deg,
    CASE WHEN ${unit('coverage')} < 0.16 THEN 0.40 + ${unit('coverage')} * 3 ELSE 1.0 END
      AS valid_pixel_fraction,
    CASE WHEN ${unit('coverage')} < 0.16 THEN 0.40 + ${unit('coverage')} * 3 ELSE 1.0 END
      AS valid_slope_pixel_fraction,
    500.0 AS effective_source_resolution_m,
    5000.0 AS cell_size_m
  FROM cells
`

/**
 * Writes the fixture Parquet files under `<root>/data/processed/parquet/`,
 * replacing any previous fixture. `appRoot` is where Hein's `queries/` live.
 */
export async function writeTerraTwinFixture(root: string, appRoot: string) {
  const parquetDir = join(root, FIXTURE_PARQUET_DIR)
  await rm(root, { recursive: true, force: true })
  await mkdir(parquetDir, { recursive: true })

  const runDiscoverySql = await readFile(
    join(appRoot, 'queries/discovery/run_discovery.sql'),
    'utf8'
  )

  const instance = await DuckDBInstance.create(':memory:', { file_search_path: root })
  const connection = await instance.connect()
  const out = (name: string) => `'${join(parquetDir, name).replaceAll("'", "''")}'`

  try {
    await connection.run(REGIONS_SQL)
    await connection.run(TERRAIN_SQL)

    await connection.run(`
      COPY (SELECT * FROM fixture_terrain ORDER BY planet, region, grid_row, grid_col)
      TO ${out('planet_terrain_features_5km_500m.parquet')} (FORMAT parquet)
    `)

    // Quality-filtered subset, like build_similarity_features.py.
    await connection.run(`
      COPY (
        SELECT planet, region, cell_id, mean_slope_deg, robust_relief_m, slope_stddev_deg
        FROM fixture_terrain
        WHERE valid_pixel_fraction >= 0.95 AND valid_slope_pixel_fraction >= 0.95
        ORDER BY planet, region, cell_id
      )
      TO ${out('planet_similarity_features_5km_500m.parquet')} (FORMAT parquet)
    `)

    // Baseline: every rank for both targets with all three features.
    await connection.run(runDiscoverySql)
    await connection.run(`
      COPY (
        SELECT target_planet, target_region, target_cell_id, earth_region, earth_cell_id,
               distance, slope_difference_z, relief_difference_z, variability_difference_z, rank
        FROM run_discovery('Moon', 'South_Pole', 'Atacama', ${ALL_FEATURES}, 1000000)
        UNION ALL
        SELECT target_planet, target_region, target_cell_id, earth_region, earth_cell_id,
               distance, slope_difference_z, relief_difference_z, variability_difference_z, rank
        FROM run_discovery('Mars', 'Jezero', 'Atacama', ${ALL_FEATURES}, 1000000)
      )
      TO ${out('terrain_analog_rankings_5km_500m.parquet')} (FORMAT parquet)
    `)
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}
