/**
 * SQL files that register the TerraTwin macros, in the order they must run.
 * Paths are relative to the app root.
 *
 * Hein's files in queries/ come first (get_candidate_details calls
 * run_discovery), then the app's own macros, which build on run_discovery.
 *
 * The DuckDB provider runs these at boot (after its data checks), and tests
 * run the same list against fixture data, so there is one source of truth.
 */
export const MACRO_SCRIPTS = [
  'queries/discovery/run_discovery.sql',
  'queries/api/get_candidate_details.sql',
  'queries/api/get_ranked_candidates.sql',
  'queries/api/get_discovery_summary.sql',
  'queries/api/get_candidate_diversity.sql',
  'database/app_macros.sql',
] as const

/**
 * Plain SELECT files (not macros). DiscoveryService runs each once, on first
 * use, and caches the rows; the data cannot change while the server runs.
 */
export const CATALOG_QUERIES = {
  catalog: 'queries/api/get_catalog.sql',
  referenceRegions: 'queries/api/get_reference_regions.sql',
} as const
