import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { CATALOG_QUERIES, MACRO_SCRIPTS } from '#database/macro_scripts'
import DiscoveryService from '#services/discovery_service'
import DuckDbService from '#services/duckdb_service'
import { pinParquetPaths, writeTerraTwinFixture } from '#database/fixtures/terratwin_fixture'

let fixtureRoot: Promise<string> | null = null

/**
 * Writes the synthetic Parquet fixture to tmp/test-fixtures/terratwin once
 * per test run and returns its root (the directory that contains
 * data/processed/parquet/).
 *
 * The root also gets a copy of every SQL file the app runs (macros and
 * catalog queries) with the Parquet paths pinned to the fixture. DuckDB
 * resolves relative paths against the working directory (the app root)
 * before `file_search_path`, so unpinned SQL would read Hein's real files
 * whenever they are present.
 */
export function terraTwinFixtureRoot(): Promise<string> {
  fixtureRoot ??= (async () => {
    const root = app.tmpPath('test-fixtures', 'terratwin')
    await writeTerraTwinFixture(root, app.makePath())
    for (const name of [...MACRO_SCRIPTS, ...Object.values(CATALOG_QUERIES)]) {
      const sql = await readFile(app.makePath(name), 'utf8')
      await mkdir(dirname(join(root, name)), { recursive: true })
      await writeFile(join(root, name), pinParquetPaths(sql, root))
    }
    return root
  })()
  return fixtureRoot
}

/**
 * A separate in-memory DuckDB instance over the fixture data, with the same
 * macros the app registers at boot, plus a DiscoveryService on top of it.
 * Call `close()` when done.
 */
export async function openTerraTwin() {
  const root = await terraTwinFixtureRoot()
  // Error-path tests make DuckDB fail on purpose; keep that out of the output.
  const quietLogger = logger.child({}, { level: 'silent' })
  const db = new DuckDbService(quietLogger)
  await db.open(':memory:')

  const scripts = await Promise.all(
    MACRO_SCRIPTS.map(async (name) => ({ name, sql: await readFile(join(root, name), 'utf8') }))
  )
  await db.runScripts(scripts)

  return {
    db,
    // The fixture root holds the pinned copies of the catalog queries too.
    discovery: new DiscoveryService(db, quietLogger, root),
    close: () => db.close(),
  }
}
