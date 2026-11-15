import { readFile } from 'node:fs/promises'
import type { ApplicationService } from '@adonisjs/core/types'
import { MACRO_SCRIPTS } from '#database/macro_scripts'
import DuckDbService from '#services/duckdb_service'

/**
 * SQL scripts that build the database, run in this order in one transaction.
 *
 * Temporary (phase-4-ui): registers the TerraTwin macros so the UI runs
 * locally. Phase 2 (step 2.4) replaces this line with
 * ['database/checks.sql', ...MACRO_SCRIPTS]; keep that version on merge.
 */
const SCRIPTS = [...MACRO_SCRIPTS]

/**
 * Builds the app's DuckDB database in memory at every boot from the SQL
 * scripts above, and closes it on shutdown.
 *
 * In memory on purpose: DuckDB locks a database file to a single process, so
 * a separate seed command could not open the file while the server runs. All
 * data comes from the seed CSVs and the app never writes, so rebuilding at
 * boot takes milliseconds and needs no database file in deployments.
 */
export default class DuckdbProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Bind DuckDbService as a singleton, so controllers and services can
   * receive it through `@inject()` or `app.container.make(DuckDbService)`.
   */
  register() {
    this.app.container.singleton(DuckDbService, async (resolver) => {
      return new DuckDbService(await resolver.make('logger'))
    })
  }

  /**
   * Open DuckDB and run the schema + seed scripts before the HTTP server
   * accepts requests. A failing script stops the app from starting.
   */
  async start() {
    const startedAt = performance.now()
    const db = await this.app.container.make(DuckDbService)

    // Relative paths in read_csv(...) resolve against the app root, in
    // development and in the production build alike.
    await db.open(':memory:', { file_search_path: this.app.makePath() })

    const scripts = await Promise.all(
      SCRIPTS.map(async (name) => ({ name, sql: await readFile(this.app.makePath(name), 'utf8') }))
    )
    await db.runScripts(scripts)

    const logger = await this.app.container.make('logger')
    logger.info(
      'DuckDB ready in memory (schema + seed in %d ms)',
      Math.round(performance.now() - startedAt)
    )
  }

  /**
   * Release the DuckDB instance when the app shuts down.
   */
  async shutdown() {
    const db = await this.app.container.make(DuckDbService)
    db.close()
  }
}
