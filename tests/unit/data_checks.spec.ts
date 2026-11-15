import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import DuckDbService from '#services/duckdb_service'
import {
  FIXTURE_FILES,
  FIXTURE_PARQUET_DIR,
  pinParquetPaths,
} from '#database/fixtures/terratwin_fixture'
import { terraTwinFixtureRoot } from '#tests/helpers/terratwin'

type FixtureFile = (typeof FIXTURE_FILES)[number]

/**
 * Builds a data root for one case: copies of the fixture files, except that
 * `skip` is left out and each `rewrite` entry is written from a SELECT over
 * the fixture file (`{source}` in the SQL is replaced with its path).
 */
async function dataRoot(
  name: string,
  options: { skip?: FixtureFile; rewrite?: Partial<Record<FixtureFile, string>> } = {}
): Promise<string> {
  const fixtureDir = join(await terraTwinFixtureRoot(), FIXTURE_PARQUET_DIR)
  const root = app.tmpPath('test-fixtures', 'data-checks', name)
  const dir = join(root, FIXTURE_PARQUET_DIR)
  await rm(root, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const db = await openDb()
  try {
    for (const file of FIXTURE_FILES) {
      const source = join(fixtureDir, file)
      const rewrite = options.rewrite?.[file]
      if (file === options.skip) continue
      if (!rewrite) {
        await copyFile(source, join(dir, file))
        continue
      }
      const select = rewrite.replaceAll('{source}', `'${source.replaceAll("'", "''")}'`)
      await db.run(
        `COPY (${select}) TO '${join(dir, file).replaceAll("'", "''")}' (FORMAT parquet)`
      )
    }
  } finally {
    db.close()
  }
  return root
}

async function openDb() {
  // The failing cases make DuckDB raise errors on purpose; keep them quiet.
  const db = new DuckDbService(logger.child({}, { level: 'silent' }))
  await db.open(':memory:')
  return db
}

/**
 * Runs database/checks.sql against the data under `root`, the way the DuckDB
 * provider does at boot. Paths are pinned to `root`, because DuckDB resolves
 * relative paths against the working directory first, where Hein's real
 * files may be.
 */
async function runChecks(root: string): Promise<void> {
  const sql = pinParquetPaths(await readFile(app.makePath('database/checks.sql'), 'utf8'), root)
  const db = await openDb()
  try {
    await db.runScripts([{ name: 'database/checks.sql', sql }])
  } finally {
    db.close()
  }
}

test.group('database/checks.sql', () => {
  test('passes on complete data', async () => {
    await runChecks(await dataRoot('complete'))
  }).timeout(20000)

  test('names a missing Parquet file and where to get it', async ({ assert }) => {
    const root = await dataRoot('missing-file', {
      skip: 'terrain_analog_rankings_5km_500m.parquet',
    })
    await assert.rejects(
      () => runChecks(root),
      /database\/checks\.sql failed: .*Missing TerraTwin data: terrain_analog_rankings_5km_500m\.parquet\. .*plan\.md step 2\.3/
    )
  }).timeout(20000)

  test('lists the columns a file is missing', async ({ assert }) => {
    const root = await dataRoot('missing-columns', {
      rewrite: {
        'planet_terrain_features_5km_500m.parquet':
          'SELECT * EXCLUDE (grid_row, valid_slope_pixel_fraction) FROM read_parquet({source})',
      },
    })
    await assert.rejects(
      () => runChecks(root),
      /planet_terrain_features_5km_500m\.parquet is missing columns: grid_row, valid_slope_pixel_fraction\./
    )
  }).timeout(20000)

  test('fails when a world has no eligible cells', async ({ assert }) => {
    const root = await dataRoot('no-eligible-mars', {
      rewrite: {
        'planet_terrain_features_5km_500m.parquet': `
          SELECT * REPLACE (
            CASE WHEN planet = 'Mars' THEN 0.5 ELSE valid_pixel_fraction END AS valid_pixel_fraction
          )
          FROM read_parquet({source})`,
      },
    })
    await assert.rejects(
      () => runChecks(root),
      /planet_terrain_features_5km_500m\.parquet has no eligible cells for: Mars /
    )
  }).timeout(20000)

  test('fails when the baseline ranking lacks a target world', async ({ assert }) => {
    const root = await dataRoot('no-moon-baseline', {
      rewrite: {
        'terrain_analog_rankings_5km_500m.parquet':
          "SELECT * FROM read_parquet({source}) WHERE target_planet <> 'Moon'",
      },
    })
    await assert.rejects(
      () => runChecks(root),
      /terrain_analog_rankings_5km_500m\.parquet has no baseline rows for: Moon\./
    )
  }).timeout(20000)
})
