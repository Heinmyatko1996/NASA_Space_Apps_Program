import type { ApplicationService } from '@adonisjs/core/types'
import DiscoveryService from '#services/discovery_service'
import DuckDbService from '#services/duckdb_service'

/**
 * Binds DiscoveryService as a singleton. It must be one instance per app:
 * it caches the catalog and tracks which configurations are already ranked
 * in the in-memory discovery_cache table. Controllers receive it through
 * `@inject()` or `app.container.make(DiscoveryService)`.
 *
 * The TerraTwin macros it calls are registered at boot by the DuckDB
 * provider (see database/macro_scripts.ts).
 */
export default class DiscoveryProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(DiscoveryService, async (resolver) => {
      return new DiscoveryService(
        await resolver.make(DuckDbService),
        await resolver.make('logger'),
        this.app.makePath()
      )
    })
  }
}
