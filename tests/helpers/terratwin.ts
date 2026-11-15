import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { MACRO_SCRIPTS } from '#database/macro_scripts'
import DiscoveryService from '#services/discovery_service'
import DuckDbService from '#services/duckdb_service'
import { writeTerraTwinFixture } from '#database/fixtures/terratwin_fixture'

let fixtureRoot: Promise<string> | null = null

/**
 * Writes the synthetic Parquet fixture to tmp/test-fixtures/terratwin once
 * per test run and returns its root (the directory that contains
 * data/processed/parquet/).
 */
export function terraTwinFixtureRoot(): Promise<string> {
  fixtureRoot ??= (async () => {
    const root = app.tmpPath('test-fixtures', 'terratwin')
    await writeTerraTwinFixture(root, app.makePath())
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
  await db.open(':memory:', { file_search_path: root })

  const scripts = await Promise.all(
    MACRO_SCRIPTS.map(async (name) => ({ name, sql: await readFile(app.makePath(name), 'utf8') }))
  )
  await db.runScripts(scripts)

  return {
    db,
    discovery: new DiscoveryService(db, quietLogger, app.makePath()),
    close: () => db.close(),
  }
}
