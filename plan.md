# Project Development Plan: Planetary Analog Discovery Engine (`plan.md`)

**Event:** 2026 NASA Space Apps Challenge  
**Challenge:** Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars  
**Architecture:** Server-Driven Hypermedia, AdonisJS v7 Hypermedia kit (Edge.js + Alpine.js + Vite + kit CSS)  
**Analog Model:** Hein's TerraTwin terrain model from `main`: an offline Python pipeline turns DEMs into Parquet files, and DuckDB SQL macros in `queries/` rank Earth terrain cells against Moon/Mars cells by standardized Euclidean distance.  
**Database:** DuckDB through its native Node API (`@duckdb/node-api`). At boot, an in-memory instance registers Hein's SQL macros, which read the prebuilt Parquet files directly. The app never writes data.  
**Geospatial Visualization:** Server-rendered NASA GIBS WMS imagery with CSS-positioned markers for Earth, and a server-rendered SVG cell grid for the Moon/Mars target region (no client map library)  
**Dependency Rule:** Only AdonisJS, what its Hypermedia starter kit installs, and `@duckdb/node-api`. No other npm packages and no CDN scripts. Python is used only offline to build the Parquet files and is not needed at runtime.

---

## 1. Core User Journey Mapping

The journey follows the four stages in Hein's `docs/website_integration.md`:

1. **Explore (page load):** Before configuring anything, the user sees what the tool does: one example card each for **Moon / South Pole** and **Mars / Jezero**, built from Hein's precomputed baseline ranking (all three features, Atacama reference). Each card shows the best-match distance spread, candidate diversity, and the top Earth candidates for a featured target cell.
2. **Configure:** The user picks:
   * Target world (**Moon** or **Mars**). The server swaps in that world's target regions from the catalog.
   * Target region (currently `South_Pole` for the Moon and `Jezero` for Mars).
   * Earth reference region (currently `Atacama` only; the list comes from the data, so new regions appear automatically).
   * Terrain features (at least one of three): **mean slope** (°), **robust relief** (m, P90 − P10 elevation), and **slope variability** (°, slope standard deviation).
   * Number of Earth candidates per target cell (top-N).
3. **Analyze:** Submitting the form runs Hein's `run_discovery` macro with those parameters. It filters eligible cells, standardizes each selected feature against the Earth reference region (median and 1.4826 × MAD), computes the distance between every target cell and every Earth cell, and ranks the Earth cells for each target cell.
4. **Understand:** The server renders:
   * A summary of this run: target cells analyzed, best-match distance quartiles, candidate diversity, and the most reused Earth cell.
   * A grid of the target region's cells, colored by each cell's best-match distance. Clicking a cell lists its ranked Earth candidates.
   * Candidate cards: rank, distance ("lower = closer"), and a signed bar per selected feature showing which feature drove the distance.
   * A detail view comparing the target and Earth cells' original terrain values (with units), data coverage, and both locations on maps.
   * Visible limitations: Atacama is the only Earth reference, distance is not a percentage, and elevation is not comparable across bodies.

### TerraTwin data & scoring model (summary of Hein's docs on `main`)

| Item | Value |
|---|---|
| Grid | 5 km cells computed from DEMs resampled to 500 m |
| Regions | Earth / Atacama (449 cells, 365 eligible), Mars / Jezero (439, 360), Moon / South_Pole (400, 324) |
| Eligibility | `valid_pixel_fraction >= 0.95` and `valid_slope_pixel_fraction >= 0.95` |
| Features | `mean_slope_deg`, `robust_relief_m`, `slope_stddev_deg` |
| Score | `distance = sqrt(Σ difference_z²)` over the selected features, standardized against the Earth reference region. Lower is closer. It is **not** a probability or a percentage. |
| Feature differences | `slope_difference_z`, `relief_difference_z`, `variability_difference_z`. Signed: positive means the target value is higher than the Earth value. Unselected features are `NULL`. |
| Data files | `data/processed/parquet/planet_terrain_features_5km_500m.parquet`, `planet_similarity_features_5km_500m.parquet`, `terrain_analog_rankings_5km_500m.parquet` (baseline, 249,660 rows) |

Distances from different feature selections are not comparable with each other, so the UI always shows the configuration next to the results.

---

## 2. System Directory Structure

```text
planetary-analog-finder/
├── app/
│   ├── controllers/
│   │   └── analogs_controller.ts       # Full page + Edge partial endpoints
│   ├── services/
│   │   ├── duckdb_service.ts           # Holds the DuckDB instance; typed query helpers
│   │   ├── discovery_service.ts        # Calls the TerraTwin macros; maps rows to view models
│   │   └── map_snapshot_service.ts     # NASA GIBS URLs + marker positions
│   └── validators/
│       └── discovery_validator.ts      # VineJS validation against the cached catalog
├── data/
│   └── processed/parquet/              # The 3 Parquet files from Hein's pipeline (committed)
├── database/
│   ├── checks.sql                      # Boot-time data checks: files, columns, regions
│   └── app_macros.sql                  # App-owned macros built on run_discovery and the Parquet files
├── docs/                               # Hein (from main): methodology and SQL/API contracts
├── queries/                            # Hein (from main): TerraTwin SQL macros and catalog queries
│   ├── api/                            # get_catalog, get_reference_regions, get_ranked_candidates,
│   │                                   # get_discovery_summary, get_candidate_diversity, get_candidate_details
│   └── discovery/run_discovery.sql     # Configurable ranking macro
├── scripts/                            # Hein (from main): offline Python pipeline, DEM → Parquet
├── providers/
│   └── duckdb_provider.ts              # Registers checks + macros at boot, closes on shutdown
├── resources/
│   ├── css/
│   │   └── app.css                     # Kit design tokens, tuned to a dark telemetry theme
│   ├── js/
│   │   └── app.js                      # Alpine components: partial swaps, presets, map layers
│   └── views/
│       ├── components/
│       │   ├── earth_map.edge          # Full-globe NASA Earth image + graticule + markers
│       │   ├── cell_grid.edge          # SVG grid of target-region cells colored by distance
│       │   └── layouts/
│       │       └── main.edge           # Base HTML shell (@vite loads app.css + app.js)
│       ├── pages/
│       │   └── home.edge               # Explore cards + Configure form + Results + Map
│       └── partials/
│           ├── region_list.edge        # Swapped on World change (Moon <-> Mars)
│           ├── discovery_results.edge  # Run summary + cell grid + candidates for the best cell
│           ├── cell_candidates.edge    # Ranked Earth candidates for one target cell
│           ├── analog_map.edge         # Atacama inset with positioned candidate markers
│           └── candidate_detail.edge   # Side-by-side target vs Earth comparison (modal)
├── start/
│   └── routes.ts                       # Route definitions
├── pyproject.toml, uv.lock             # Python environment for scripts/ only
└── plan.md                             # Project roadmap
```

**Ownership:** `queries/`, `scripts/`, and `docs/` belong to Hein. The app uses them unmodified, and changes to them go through Hein. SQL the app needs beyond Hein's macros lives in `database/app_macros.sql`, ready to move into `queries/` later if Hein agrees.

---

## 3. Phase-by-Phase Implementation Plan

### Phase 1: Environment Setup & AdonisJS Hypermedia Scaffolding (Hours 0–3)
**Objective:** Initialize the AdonisJS v7 Hypermedia stack, strip its built-in authentication and Lucid, theme the kit's CSS, and wire DuckDB into the app lifecycle.

- [x] **1.1 Initialize Project (Node.js 24.11.1+):**
  ```bash
  npm create adonisjs@latest planetary-analog-finder -- --kit=hypermedia
  cd planetary-analog-finder
  npm install @duckdb/node-api
  ```
  - Node 24.0–24.11.0 crash `npm run dev`: `hot-hook` falls back to `module.register()` hooks there, and CommonJS packages then fail to load (`ERR_INVALID_RETURN_PROPERTY_VALUE`); importing `@duckdb/node-api` through the TypeScript loader also hits `ERR_INTERNAL_ASSERTION`. `package.json` `engines` requires `>=24.11.1`, and `.nvmrc` pins Node 26 (the current LTS).
  - The installer refuses a non-empty folder, so it scaffolds into a subfolder whose files then move to the repo root next to `plan.md`.
- [x] **1.2 Remove Built-in Authentication:** The app is a public, anonymous tool with no accounts or user data, but the Hypermedia kit ships with session-based signup/login. Strip it right after scaffolding:
  - Uninstall the package: `npm uninstall @adonisjs/auth`.
  - Delete auth files: `config/auth.ts`, `app/models/user.ts`, `app/validators/user.ts`, `app/controllers/new_account_controller.ts`, `app/controllers/session_controller.ts`, `app/middleware/{auth,guest,silent_auth}_middleware.ts`, `resources/views/pages/auth/`, and `resources/views/pages/dashboard.edge`.
  - Delete the account layouts `resources/views/components/layouts/{app,auth,settings}.edge` (they hold the logout form and dashboard nav). In `layouts/marketing.edge`, which the kit's `home.edge` uses until it is rebuilt on `main.edge`, remove the `@if(auth?.user)` block with the Sign in / Get started / Dashboard links.
  - `adonisrc.ts`: remove the `@adonisjs/auth/auth_provider` provider.
  - `start/kernel.ts`: remove `initialize_auth_middleware` and `silent_auth_middleware` from `router.use`, and the `guest` / `auth` named middleware.
  - `start/routes.ts`: remove the signup, login, logout, and dashboard route groups.
  - `tests/bootstrap.ts`: remove the `authBrowserClient` plugin.
  - Keep `@adonisjs/session` and `@adonisjs/shield`; flash messages and CSRF protection still depend on them.
- [x] **1.3 Remove Lucid (DuckDB replaces it):**
  - Uninstall the packages: `npm uninstall @adonisjs/lucid better-sqlite3`, and drop `better-sqlite3` from `allowScripts` in `package.json`.
  - Delete `config/database.ts`, `database/schema.ts`, `database/schema_rules.ts`, and `database/migrations/`.
  - `adonisrc.ts`: remove `@adonisjs/lucid/commands` and `@adonisjs/lucid/database_provider`.
  - `config/session.ts`: remove the `database` session store, and drop `'database'` from `SESSION_DRIVER` in `start/env.ts`. The session provider resolves every configured store, and this one needs Lucid, so every request returns a 500 (`Cannot resolve binding "lucid.db"`).
  - `tests/bootstrap.ts`: remove the `dbAssertions` plugin.
  - Keep `luxon`; the kit's `start/validator.ts` still uses it.
- [x] **1.4 Configure Frontend Shell (`resources/views/components/layouts/main.edge`):**
  - Build `main.edge` from the `<head>` of the kit's `marketing.edge`: `@vite(['resources/css/app.css', 'resources/js/app.js'])` loads the kit's stylesheet and its Alpine.js bundle. No CDN `<script>` or `<link>` tags.
  - Set up the dark space-telemetry theme by rendering `<html data-theme="dark">` by default and adjusting the kit's color tokens in `app.css` (`--paper`, `--card`, `--ink`, `--line`). Use `var(--mono)` for numeric readouts. Keep the kit's `themeToggle` component.
  - Use the kit's `edge-iconify` Lucide icons for UI glyphs (e.g., `@svg('lucide:satellite')`, `@svg('lucide:map-pin')`).
- [x] **1.5 Wire DuckDB into the App Lifecycle (`node ace make:provider duckdb --register`):**
  - `register()`: bind `DuckDbService` as a container singleton.
  - `start()`: `DuckDBInstance.create(':memory:', { file_search_path: app.makePath() })`, then run `database/schema.sql` and `database/seed.sql` on one connection inside one `BEGIN … COMMIT` (`DuckDbService.runScripts`). Each file is a single `connection.run(sql)` call, because `run()` without parameters executes every statement in the string. A failing script rolls back and stops the app from starting.
  - `shutdown()`: close the DuckDB instance.
  - `DuckDbService.all<T>(sql, params)` / `first<T>()` wrap `connection.runAndReadAll(sql, params).getRowObjectsJS()` with named `$param` bindings and structured error logging. Each call opens its own short-lived connection (under 0.1 ms), so concurrent requests run in parallel instead of queueing on one shared connection.
  - `adonisrc.ts` `metaFiles` copies `database/**/*.sql` and `database/seeds/*.csv` into the build and restarts the dev server when they change.
  - **Why in memory:** DuckDB locks a database file to one process, so while `node ace serve` holds `analog.duckdb`, no other process (such as a seed command) can open it, even read-only. The data is fully derived from the seed CSVs and the app never writes, so rebuilding at boot takes a few milliseconds and avoids the lock.
  - **Gotcha:** `BIGINT` results such as `count(*)` come back as JS `bigint` (`3n`). Cast them to `INTEGER` in SQL before passing rows to Edge.

---

### Phase 2: Bring In Hein's TerraTwin Data & SQL (Hours 3–9)
**Objective:** Merge Hein's pipeline, queries, and docs from `main`; get the processed Parquet files; and register the TerraTwin macros in the app's DuckDB instance at boot. This replaces the curated-CSV schema and seed files from step 1.5.

- [ ] **2.1 Merge `main` into `dev`:**
  - `git merge origin/main`. A trial merge has no conflicts: `main` only adds `queries/`, `scripts/`, `docs/`, and `dataset_to_download.md`.
  - **Restore the Python and data ignore rules in the same merge.** `dev` replaced the Python `.gitignore`, and git keeps `dev`'s version, so after the merge `data/`, `.venv/`, and `__pycache__/` are no longer ignored. Hein's raw and intermediate GeoTIFFs could then be committed by accident. Append:
    ```gitignore
    # Python (scripts/ pipeline)
    __pycache__/
    *.py[cod]
    .venv/

    # Geospatial data: raw and intermediate files stay local
    data/raw/
    data/processed/*
    !data/processed/parquet/
    data/processed/parquet/*
    !data/processed/parquet/*_5km_500m.parquet
    ```
- [ ] **2.2 Restore the Python Environment for `scripts/`:**
  - `dev` deleted `pyproject.toml`, `uv.lock`, and `.python-version`, but Hein's scripts need them. Restore a slim `pyproject.toml` (`requires-python = ">=3.11"`) with only what `scripts/` imports: `numpy`, `pandas`, `pyarrow`, `rasterio`, `pyproj`. Add `duckdb` to run the SQL from Python or the CLI. Then run `uv lock`.
  - `scripts/build_common_resolution_slopes.sh` calls `gdaldem`, so the GDAL command-line tools must be installed on the machine that runs the pipeline (`apt install gdal-bin` / `brew install gdal`).
- [ ] **2.3 Get the Processed Parquet Files:**
  - **Fast path:** copy the three `*_5km_500m.parquet` files from Hein into `data/processed/parquet/`.
  - **Rebuild path** (from the repo root, given the clipped AOI DEMs `data/processed/aoi/{earth_atacama,moon_south,mars_jezero}_dem.tif` from Hein, which no script creates):
    ```bash
    uv run python scripts/build_common_resolution_dems.py      # → data/processed/common_resolution/*_dem_500m.tif
    bash scripts/build_common_resolution_slopes.sh             # → *_slope_500m.tif (gdaldem)
    uv run python scripts/build_common_resolution_features.py  # → planet_terrain_features_5km_500m.parquet
    uv run python scripts/build_similarity_features.py         # → planet_similarity_features_5km_500m.parquet
    uv run python scripts/build_terrain_analog_ranking.py      # → terrain_analog_rankings_5km_500m.parquet
    ```
    `build_planet_features.py`, `build_atacama_features.py`, and `validate_planet_features.py` produce the older `_5km` files, which the website queries don't use.
  - **Commit the three Parquet files** (the `.gitignore` exceptions in 2.1 allow exactly these). Then the server runs right after a clone, and deployment needs no Python or raw data. Check their size with `du -h` first, and switch to Git LFS if any file is large. Agree on this with Hein, who regenerates them.
- [ ] **2.4 Register the TerraTwin Macros at Boot (`providers/duckdb_provider.ts`):**
  - Replace `SCRIPTS` (and delete `database/schema.sql` / `database/seed.sql`) with:
    ```ts
    const SCRIPTS = [
      'database/checks.sql',
      'queries/discovery/run_discovery.sql',
      'queries/api/get_candidate_details.sql',
      'queries/api/get_ranked_candidates.sql',
      'queries/api/get_discovery_summary.sql',
      'queries/api/get_candidate_diversity.sql',
      'database/app_macros.sql',
    ]
    ```
  - Hein's docs say to register macros "once per connection". That doesn't apply here: his files use `CREATE OR REPLACE MACRO` (not `TEMP`), so the macros live in the in-memory database's catalog, and every short-lived connection `DuckDbService` opens on the same instance sees them. Registering once at boot is enough.
  - `get_catalog.sql` and `get_reference_regions.sql` are plain `SELECT`s, not macros. `DiscoveryService` reads them from disk and runs them **once at boot**, then caches the rows; the data cannot change while the server runs.
  - Relative paths in Hein's `read_parquet('data/processed/parquet/…')` resolve through the existing `file_search_path`, in dev and in the production build alike.
  - `queries/catalog/*.sql`, `queries/discovery/earth_reference_statistics.sql`, and `queries/discovery/rank_earth_candidates.sql` are Hein's standalone analysis queries; the app does not load them.
- [ ] **2.5 Write Boot-Time Data Checks (`database/checks.sql`):**
  - DuckDB binds a macro body only when it is called, so missing Parquet files would not fail boot; the first request would fail instead. `checks.sql` reads each of the three files and uses `error()` to stop boot with a clear message (e.g., `Missing data/processed/parquet/…: see plan.md step 2.3`).
  - Check that each file exists, that the columns the macros use are present (`planet`, `region`, `cell_id`, `grid_row`, `grid_col`, `latitude_center`, `longitude_center`, the three features, both coverage fractions), and that Earth, Moon, and Mars each have eligible cells. Don't hard-code row counts, because Hein will add Earth regions.
- [ ] **2.6 Write App-Owned Macros (`database/app_macros.sql`):**
  - `custom_discovery_summary(planet, region, reference, features, top_n)`: the same output columns as Hein's `get_discovery_summary` (cell count, min/q25/median/q75/max/mean best distance), but computed from the rank-1 rows of `run_discovery` instead of the baseline file. Hein's integration guide requires this: baseline summaries must not be shown as custom-discovery results.
  - `custom_candidate_diversity(...)`: the same columns as Hein's `get_candidate_diversity`, also computed from `run_discovery` rank-1 rows. Matching column names let one partial render both baseline and custom results.
  - `target_cells(planet, region)`: `cell_id`, `grid_row`, `grid_col`, latitude/longitude, and an `eligible` flag (both coverage fractions ≥ 0.95) from `planet_terrain_features_5km_500m.parquet`, for the cell grid. `grid_row` / `grid_col` can be negative (e.g., `…_r-7_c-3`), so the grid component offsets them by their minimum.
  - `region_extent(planet, region)`: min/max latitude and longitude of a region's cells, for the Atacama map inset (no hard-coded bounding box).
  - `featured_target_cell(planet, region)`: the target cell with the lowest rank-1 baseline distance, for the Explore cards.
- [ ] **2.7 Build & Dev-Server Config (`adonisrc.ts`):**
  - Replace the `database/seeds/*.csv` `metaFiles` entry with `queries/**/*.sql` and `data/processed/parquet/*.parquet`, both with `reloadServer: true`. Keep `database/**/*.sql`.
- [ ] **2.8 Verify from the Command Line:**
  - From the repo root, in the DuckDB CLI: `.read queries/discovery/run_discovery.sql`, then `SELECT * FROM run_discovery('Moon', 'South_Pole', 'Atacama', ['mean_slope_deg', 'robust_relief_m'], 10) WHERE target_cell_id = 'moon_south_south_pole_r8_c4' ORDER BY rank;`. Rank 1 should be `earth_atacama_atacama_r-7_c-3` with distance ≈ 4.497, as in the example in `docs/api/candidate_details_reponse.md`.
  - `npm run dev` logs `DuckDB ready in memory`. Temporarily rename one Parquet file and confirm boot stops with the message from `checks.sql`.

---

### Phase 3: Discovery Service & Validation (Hours 9–13)
**Objective:** One service that calls the TerraTwin macros with bound parameters and returns view-ready objects, plus validation that only accepts values the catalog offers.

- [ ] **3.1 Implement `DiscoveryService` (`app/services/discovery_service.ts`):**
  - `catalog()` / `referenceRegions()`: cached boot results from 2.4, grouped by `item_type` (`world`, `region`, `feature`).
  - `baseline(world, region)`: `get_discovery_summary`, `get_candidate_diversity`, and `get_ranked_candidates` for `featured_target_cell`, for the Explore cards.
  - `run(config)`: `custom_discovery_summary`, `custom_candidate_diversity`, `target_cells`, and the rank-1 rows of `run_discovery` (to color the grid).
  - `cellCandidates(config, cellId)`: `run_discovery` rows for one target cell, ordered by rank and joined to `planet_terrain_features_5km_500m.parquet` for each Earth cell's coordinates.
  - `candidateDetails(config, cellId, rank)`: `get_candidate_details`.
  - Bind every value with `$name` placeholders, never string concatenation. Bind `featureIds` with `listValue()` from `@duckdb/node-api` and cast in SQL (`$features::VARCHAR[]`, `$topN::INTEGER`), because a JS number binds as `DOUBLE` by default. Add a unit test that a list binding reaches `run_discovery` correctly.
  - Cast `rank` and every count to `INTEGER` in the wrapping `SELECT` (the `BIGINT` gotcha from 1.5).
  - Map snake_case columns to the camelCase names in `docs/api/candidate_details_reponse.md` (e.g., `slope_difference_z` → `featureDifferences.meanSlopeZ`), keeping `NULL` for unselected features.
- [ ] **3.2 Validate Input (`app/validators/discovery_validator.ts`):**
  - VineJS rules backed by the cached catalog: `world` is a catalog world; `region` belongs to that world; `reference` is a catalog reference region; `features` is an array of 1–3 unique catalog feature IDs; `topN` is an integer from 1 to 25.
  - The checkbox field is named `features[]` so the query string parses to an array.
- [ ] **3.3 Translate SQL Errors:**
  - `run_discovery` raises its own errors (`Select at least one feature`, `Duplicate feature IDs are not allowed`, `Unknown feature ID supplied`, `p_top_n must be greater than zero`, `Unsupported target planet`, `No eligible Earth reference cells`, `No eligible target cells`). Validation should catch these first, but if one reaches DuckDB, map the message to a 422 with a readable field error instead of a 500.
- [ ] **3.4 Measure Performance:**
  - Each call recomputes about 118k–131k target × Earth pairs. Log the query time for each request (used by the header indicator in 6.3). If a call takes longer than about 50 ms, cache results in memory by normalized configuration. There are few configurations: 2 targets × 7 feature subsets × 1 reference region.

---

### Phase 4: Hypermedia UI & 4-Stage Journey Wiring (Hours 13–22)
**Objective:** Build the server-rendered Edge views and partials. Alpine.js, which the kit already bundles, fetches the partials and swaps them into the page, so every user action updates the UI without a page reload.

- [ ] **4.1 Add a Partial-Swap Helper (`resources/js/app.js`):**
  - Register an `Alpine.magic('swap', …)` helper (about 15 lines) that `fetch`es an Edge partial URL and replaces a target element's `innerHTML`. Alpine's mutation observer initializes any Alpine markup inside the new HTML automatically.
  - Track a shared `loading` flag in an `Alpine.store('ui')` to drive skeleton loaders.
  - All partial endpoints are read-only `GET` routes under `/partials/*`, so the helper needs no CSRF token.
- [ ] **4.2 Explore Cards (`home.edge`, rendered at page load):**
  - One card each for Moon / South Pole and Mars / Jezero from `DiscoveryService.baseline()`: target cell count, median and range of best-match distances, candidate diversity (e.g., Moon 20.68%, Mars 48.89%), and the featured cell's top 3 Earth candidates.
  - Label them "Baseline example: all three features, Atacama reference". A "Use this setup" button pre-fills the Configure form.
- [ ] **4.3 Configure Form (`partials/region_list.edge`):**
  - Radio buttons for **Moon** / **Mars** call `$swap('/partials/regions?world=Moon', '#region-selector')`, which renders that world's regions from the catalog with each region's eligible cell count.
  - Earth reference region `<select>` filled from `referenceRegions()`. While Atacama is the only option, show a note: "More Earth regions are coming; results are the best analogs within Atacama."
  - One checkbox per catalog feature, using `feature_label`, `unit`, and `description` as help text, and pre-checked from `default_selected`.
  - A top-N number input (1–25, default 10), described as "Earth candidates per target cell".
  - Optional quick presets that only set feature checkboxes and submit: *Full terrain (baseline)* = all three; *Rover traverse* = mean slope + slope variability; *Landing zone survey* = mean slope.
- [ ] **4.4 Analyze → Results (`partials/discovery_results.edge`):**
  - The form uses `@submit.prevent` to call `$swap('/partials/discover?' + new URLSearchParams(new FormData($el)), '#results')`, then `history.replaceState` puts the same query string in the page URL so a result can be shared and reproduced.
  - Render a configuration line (world, region, reference, features, top-N), the run summary and diversity from `custom_discovery_summary` / `custom_candidate_diversity`, the target cell grid (Phase 5.2), and the candidate list for the best-matching cell.
- [ ] **4.5 Understand → Ranked Candidates (`partials/cell_candidates.edge`):**
  - Clicking a grid cell calls `$swap('/partials/cells/:cellId?' + configQuery, '#cell-candidates')`. Every partial receives the full configuration in its query string, so the server stays stateless.
  - Each candidate card shows the rank, the Earth cell ID, the distance to 2 decimal places labeled "distance (lower = closer)", and one horizontal bar per selected feature centered on zero, from the signed `*_difference_z` values. Bar direction shows whether the target is higher or lower than the Earth cell; bar length shows that feature's contribution.
  - Never show a percentage. A color band is allowed if it is relative to this run's quartiles and says so (e.g., "best 25% of matches in this run").
  - A limitations footer on every result: Atacama is the only Earth reference; distance is not a probability or percentage; elevation isn't compared across bodies; terrain similarity alone doesn't establish landing-site safety.

---

### Phase 5: Server-Rendered Maps (Hours 22–30)
**Objective:** Show where the matches are without a client map library. The server builds NASA image URLs and computes marker positions itself.

- [ ] **5.1 Build `MapSnapshotService` (`app/services/map_snapshot_service.ts`):**
  - Given a bounding box, build a NASA GIBS WMS `GetMap` URL (`EPSG:4326`, fixed width/height, `image/jpeg`). WMS 1.3.0 expects the `EPSG:4326` `BBOX` in lat/lon axis order.
  - Project each candidate's lat/lon to `left %` / `top %` inside that box. EPSG:4326 imagery is equirectangular, so the projection is a linear interpolation.
- [ ] **5.2 Render the Target Cell Grid (`resources/views/components/cell_grid.edge`):**
  - An inline SVG with one square per row of `target_cells(planet, region)`, placed by `grid_col` / `grid_row` after offsetting by their minimum. Check the row direction against `latitude_center` and flip if needed so north is up.
  - Fill eligible cells by best-match distance using this run's quartile bands, and hatch ineligible cells with the tooltip "excluded: < 95% data coverage". Each cell is a button that loads its candidates (4.5); the selected cell gets an outline.
  - A grid instead of planetary imagery is intentional: the Moon South Pole region lies near −88° latitude, where equirectangular imagery and linear marker projection break down. Solar System Treks polar imagery behind the grid is a stretch goal.
- [ ] **5.3 Render the Earth Map (`resources/views/components/earth_map.edge`):**
  - Build a reusable Edge component that renders a full-globe Earth image: a GIBS WMS `GetMap` request with `BBOX=-90,-180,90,180`, a 2:1 width/height ratio (e.g., `2048×1024`), and the VIIRS or Blue Marble true-color layer.
  - Wrap the `<img>` in a `position: relative` container with `aspect-ratio: 2 / 1` so the layout is fixed before the image loads, and give it `alt` text and a `loading` skeleton.
  - Overlay a CSS graticule (lat/lon lines every 30°) and the equator for orientation. The component accepts a `markers` prop (`{ lat, lon, label, band }[]`) and places each one with the same linear lat/lon → `left %` / `top %` projection.
  - Render it on `home.edge` at page load with a marker for each Earth reference region, so users see the Earth map immediately.
- [ ] **5.4 Render `partials/analog_map.edge` with Every Result:**
  - An Atacama inset built from `region_extent('Earth', 'Atacama')` plus a small margin, with markers for the selected target cell's ranked Earth candidates (numbered by rank). Clicking a card or marker highlights the other.
- [ ] **5.5 Add a NASA GIBS Layer Switcher:**
  - Alpine buttons switch the inset `src` between GIBS layers (VIIRS True Color, MODIS Land Surface Temperature, ASTER GDEM Elevation) for context. The service pre-builds one URL per layer. These layers are context only; the ranking uses terrain features alone.

---

### Phase 6: Candidate Detail & Polish (Hours 30–40)
**Objective:** Give judges the scientific detail behind each match, from `get_candidate_details`.

- [ ] **6.1 Candidate Detail Modal (`GET /partials/candidates/:cellId/:rank?…config`):**
  - "Inspect match" on any candidate card swaps `partials/candidate_detail.edge` into an Alpine-controlled modal (`x-show`, closes on `Esc`/backdrop).
  - Side-by-side table of the target and Earth cells' original values with units: mean slope (°), robust relief (m), slope variability (°). Mean elevation is shown with the note "not comparable across bodies: different vertical reference systems".
  - The signed feature-difference bars from 4.5, the distance, and the rank.
  - Data coverage for both cells as percentages (`valid_pixel_fraction` 1.0 → 100%).
  - Both locations: the Earth cell on the Atacama inset and the target cell highlighted on the cell grid, each with coordinates in decimal degrees.
  - Dataset citations (Earth SRTM, Moon LRO LOLA, Mars MGS MOLA); confirm the exact products with Hein.
- [ ] **6.2 Field-Test Notes Based on Terrain:**
  - From the smallest absolute feature differences, suggest terrain-relevant tests, e.g., closest on mean slope → lander touchdown and slope traverse trials; closest on slope variability → rover suspension and obstacle trials; closest on relief → EVA navigation across similar elevation spread.
  - Always add: "Based on terrain shape only. Gravity, regolith, temperature, and radiation are not compared."
- [ ] **6.3 UI/UX & Performance Audit:**
  - Show the query time from 3.4 in the UI header (e.g., `run_discovery: 18 ms · 324 target cells × 365 Earth cells`).
  - Ensure zero layout shift during partial swaps using fixed-size skeleton loaders driven by the `ui.loading` store.
  - Search the views for `%` next to any distance and remove it.

---

### Phase 7: Deployment, Demo Verification & Pitch Prep (Hours 40–48)
**Objective:** Package the application for live evaluation and finalize the Space Apps submission artifacts.

- [ ] **7.1 Production Build & Containerization:**
  - Verify `node ace build` bundles assets and copies `queries/**/*.sql`, `database/*.sql`, and the three Parquet files (via `metaFiles`). The DuckDB database is rebuilt in memory on every boot, so no database file is deployed, and the host needs neither Python nor GDAL.
  - Deploy to a Node.js 24+ host (Railway, Fly.io, or Render).
- [ ] **7.2 README (`README.md`, deleted on `dev`):**
  - How to run the app, how the data is built (link to 2.3 and Hein's `docs/methodology/data_sources.md`), the scoring model, the limitations, and the NASA dataset citations.
- [ ] **7.3 Final Submission Checklist:**
  - Record a 30-second/2-minute walkthrough: the Explore cards → Moon / South Pole → choose features → run discovery → click the best-matching cell → inspect its #1 Atacama candidate in the detail modal and on the map.
  - Rehearse one sentence explaining distance ("standardized terrain difference; lower is closer; not a percentage") and one stating the Atacama-only limitation.

---

## 4. Verification Criteria & Definition of Done

1. **End-to-End Hypermedia Flow:** Changing the world, region, features, or top-N and submitting updates the UI via Alpine-swapped Edge partials with zero full-page reloads. Every result URL reproduces the same result when opened.
2. **Hein's Model, Unmodified:** Rankings come from `run_discovery` and details from `get_candidate_details` in `queries/`, unchanged. App-specific SQL lives only in `database/`. Custom runs never display baseline summaries.
3. **Explainable Ranking:** Every candidate shows its rank, its distance labeled "lower = closer", signed per-feature differences, and the original terrain values with units. No percentage appears next to a distance anywhere.
4. **Honest Limits:** Atacama-only coverage, non-comparable elevation, and "terrain only" are visible wherever results appear.
5. **Data Safety:** Boot fails with a clear message if a Parquet file is missing. Raw and intermediate geospatial files stay out of git.
6. **No Authentication:** Every route is public. The app has no login, signup, users table, or `@adonisjs/auth` dependency.
7. **Minimal Stack:** `package.json` holds only the Hypermedia kit's own dependencies (minus `@adonisjs/auth`, `@adonisjs/lucid`, and `better-sqlite3`) plus `@duckdb/node-api`. No CDN scripts or styles appear in any Edge template. Python runs only offline in `scripts/`.
