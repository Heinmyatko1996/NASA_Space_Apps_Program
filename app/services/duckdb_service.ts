import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBType,
  type DuckDBValue,
} from '@duckdb/node-api'
import type { Logger } from '@adonisjs/core/logger'

export type QueryParams = DuckDBValue[] | Record<string, DuckDBValue>

/**
 * Optional DuckDB types for bound values, matched by position or name. Most
 * values infer their type, but an empty list cannot (`listValue([])` fails
 * with "item type of ANY"), so pass e.g. `{ features: LIST(VARCHAR) }`.
 */
export type QueryTypes = DuckDBType[] | Record<string, DuckDBType | undefined>

/**
 * Owns the app's DuckDB instance (in memory, rebuilt at every boot by
 * `providers/duckdb_provider.ts`) and exposes small query helpers.
 *
 * Every call opens its own short-lived connection. Opening one costs well
 * under 0.1 ms, and separate connections let concurrent requests run in
 * parallel instead of queueing on a single shared connection.
 */
export default class DuckDbService {
  #instance: DuckDBInstance | null = null

  constructor(private logger: Logger) {}

  /**
   * Creates the DuckDB instance. `options` are DuckDB configuration settings,
   * e.g. `{ file_search_path: '/app/root' }` so `read_csv('database/…')`
   * resolves against the app root.
   */
  async open(path = ':memory:', options: Record<string, string> = {}) {
    if (this.#instance) {
      throw new Error('DuckDB is already open')
    }
    this.#instance = await DuckDBInstance.create(path, options)
  }

  /**
   * Runs SQL scripts in order on one connection inside a single transaction.
   * Each script may hold many statements. If any statement fails, everything
   * is rolled back and the error is rethrown, prefixed with the script name.
   */
  async runScripts(scripts: { name: string; sql: string }[]): Promise<void> {
    await this.#withConnection(async (connection) => {
      await connection.run('BEGIN TRANSACTION')
      for (const script of scripts) {
        try {
          // run() without parameters executes every statement in the string
          await connection.run(script.sql)
        } catch (error) {
          // Closing the connection also discards the transaction, so a failed
          // ROLLBACK must not hide the original error.
          await connection.run('ROLLBACK').catch(() => {})
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`${script.name} failed: ${message}`, { cause: error })
        }
      }
      await connection.run('COMMIT')
    })
  }

  /**
   * Runs a query and returns every row as a plain object. Bind values with
   * `$name` placeholders and an object, or `$1, $2…` / `?` and an array.
   *
   * BIGINT columns (such as `count(*)`) come back as JS `bigint`; cast them
   * to INTEGER in SQL before handing rows to Edge templates.
   */
  async all<Row extends Record<string, unknown>>(
    sql: string,
    params?: QueryParams,
    types?: QueryTypes
  ): Promise<Row[]> {
    return this.#withConnection(async (connection) => {
      try {
        const reader = await connection.runAndReadAll(sql, params, types)
        return reader.getRowObjectsJS() as Row[]
      } catch (error) {
        this.logger.error({ err: error, sql, params }, 'DuckDB query failed')
        throw error
      }
    })
  }

  /**
   * Like `all()`, but returns only the first row (or null when there is none).
   */
  async first<Row extends Record<string, unknown>>(
    sql: string,
    params?: QueryParams,
    types?: QueryTypes
  ): Promise<Row | null> {
    const rows = await this.all<Row>(sql, params, types)
    return rows[0] ?? null
  }

  /**
   * Runs a statement that returns no rows you need, such as an INSERT into
   * an in-memory cache table.
   */
  async run(sql: string, params?: QueryParams, types?: QueryTypes): Promise<void> {
    await this.#withConnection(async (connection) => {
      try {
        await connection.run(sql, params, types)
      } catch (error) {
        this.logger.error({ err: error, sql, params }, 'DuckDB statement failed')
        throw error
      }
    })
  }

  /**
   * Closes the instance. Called by the provider when the app shuts down.
   */
  close() {
    this.#instance?.closeSync()
    this.#instance = null
  }

  async #withConnection<T>(work: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
    if (!this.#instance) {
      throw new Error(
        'DuckDB is not open yet. It opens when the app starts (DuckdbProvider.start).'
      )
    }
    const connection = await this.#instance.connect()
    try {
      return await work(connection)
    } finally {
      connection.closeSync()
    }
  }
}
