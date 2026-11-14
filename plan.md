# Project Development Plan: Planetary Analog Discovery Engine (`plan.md`)

**Event:** 2026 NASA Space Apps Challenge  
**Challenge:** Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars  
**Architecture:** Server-Driven Hypermedia, AdonisJS v7 Hypermedia kit (Edge.js + Alpine.js + Vite + kit CSS)  
**Database:** DuckDB through its native Node API (`@duckdb/node-api`). The schema is built from plain SQL files in memory at server boot, and scoring uses SQL weighted similarity.  
**Geospatial Visualization:** Server-rendered NASA GIBS WMS / Solar System Treks imagery with CSS-positioned markers (no client map library)  
**Dependency Rule:** Only AdonisJS, what its Hypermedia starter kit installs, and `@duckdb/node-api`. No other npm packages and no CDN scripts.

---

## 1. Core User Journey Mapping

The application guides the user chronologically from planetary target selection to terrestrial analog discovery:

1. **Step 1 — Select Reference World (Prompt Step 5):** User chooses between **The Moon** (Artemis South Pole / Mare sites) or **Mars** (Exploration Zones / Subsurface Ice sites).
2. **Step 2 — Select Planetary Reference Region (Prompt Step 4):** The server swaps in the available planetary target sites from the DuckDB `planetary_references` table, displaying orbital metadata from LRO/MRO (elevation, slope, temperature, volatiles, mineralogy).
3. **Step 3 — Configure Terrain Characteristic Weights (Prompt Step 3):** User adjusts priority sliders (`[0 - 5]`) across five scientific dimensions:
   * Topography & Slope (`LOLA` / `MOLA` vs. `NASADEM`)
   * Surface Roughness & Obstacle Density (Rover mobility / landing safety)
   * Mineralogy & Geochemistry (`CRISM` / `Moon Mineralogy Mapper` vs. `NASA EMIT`)
   * Subsurface Ice & Volatiles (`LRO LAMP/Mini-RF` & `SHARAD` vs. Permafrost/Glacial analogs)
   * Thermal & Illumination Extremes (`Diviner` vs. `MODIS LST`)
4. **Step 4 — Execute Analog Discovery Analysis (Prompt Step 2):** Submitting the discovery form runs a parameterized DuckDB query that computes weighted feature similarity and per-dimension match breakdowns in <10ms.
5. **Step 5 — Explore Ranked Earth Candidate Regions & Explainability (Prompt Step 1):** Server renders ranked Earth candidate cards with:
   * Overall Similarity Score (`%`) and per-feature explainability bars ("Why It Matches").
   * Side-by-side physical metric comparison (Target vs. Earth site).
   * Operational Mission Fit tags (e.g., *ISRU Excavation*, *EVA Suit Mobility*, *Subsurface Radar Calibration*) and Explicit Analog Limitations (gravity, atmospheric pressure, radiation).
   * Synchronized split-screen Planetary / Earth map snapshots.

---

## 2. System Directory Structure

```text
planetary-analog-finder/
├── app/
│   ├── controllers/
│   │   └── analogs_controller.ts       # Full page + Edge partial endpoints
│   ├── services/
│   │   ├── duckdb_service.ts           # Holds the DuckDB connection; typed query helpers
│   │   ├── analog_search_service.ts    # Weighted similarity SQL
│   │   └── map_snapshot_service.ts     # NASA imagery URLs + marker positions
│   └── validators/
│       └── discovery_validator.ts      # VineJS validation for weights & reference IDs
├── database/
│   ├── schema.sql                      # DDL: enum type, tables, PK / NOT NULL / CHECK constraints
│   ├── seed.sql                        # INSERT … SELECT FROM read_csv(...) for each table
│   └── seeds/
│       ├── planetary_references.csv    # Curated Moon Trek / Mars Trek target metrics
│       └── earth_candidates.csv        # Curated EMIT / NASADEM / MODIS barren Earth regions
├── providers/
│   └── duckdb_provider.ts              # Builds schema + seed at boot, closes on shutdown
├── resources/
│   ├── css/
│   │   └── app.css                     # Kit design tokens, tuned to a dark telemetry theme
│   ├── js/
│   │   └── app.js                      # Alpine components: partial swaps, presets, map layers
│   └── views/
│       ├── components/
│       │   └── layouts/
│       │       └── main.edge           # Base HTML shell (@vite loads app.css + app.js)
│       ├── pages/
│       │   └── home.edge               # Split-screen dashboard (Control Panel + Results + Map)
│       └── partials/
│           ├── reference_list.edge     # Swapped on World change (Moon <-> Mars)
│           ├── reference_preview.edge  # Displays selected planetary site telemetry
│           ├── ranked_results.edge     # Ranked Earth analog cards & explainability bars
│           ├── analog_map.edge         # NASA imagery snapshot with positioned markers
│           └── comparison_modal.edge   # Deep-dive side-by-side scientific breakdown
├── start/
│   └── routes.ts                       # Route definitions
└── plan.md                             # Project roadmap
```

---

## 3. Phase-by-Phase Implementation Plan

### Phase 1: Environment Setup & AdonisJS Hypermedia Scaffolding (Hours 0–3)
**Objective:** Initialize the AdonisJS v7 Hypermedia stack, strip its built-in authentication and Lucid, theme the kit's CSS, and wire DuckDB into the app lifecycle.

- [ ] **1.1 Initialize Project (Node.js 24+, required by the v7 kit):**
  ```bash
  npm create adonisjs@latest planetary-analog-finder -- --kit=hypermedia
  cd planetary-analog-finder
  npm install @duckdb/node-api
  ```
- [ ] **1.2 Remove Built-in Authentication:** The app is a public, anonymous tool with no accounts or user data, but the Hypermedia kit ships with session-based signup/login. Strip it right after scaffolding:
  - Uninstall the package: `npm uninstall @adonisjs/auth`.
  - Delete auth files: `config/auth.ts`, `app/models/user.ts`, `app/validators/user.ts`, `app/controllers/new_account_controller.ts`, `app/controllers/session_controller.ts`, `app/middleware/{auth,guest,silent_auth}_middleware.ts`, `resources/views/pages/auth/`, and `resources/views/pages/dashboard.edge`.
  - Delete the account layouts `resources/views/components/layouts/{app,auth,settings}.edge` (they hold the logout form and dashboard nav). In `layouts/marketing.edge`, which the kit's `home.edge` uses until it is rebuilt on `main.edge`, remove the `@if(auth?.user)` block with the Sign in / Get started / Dashboard links.
  - `adonisrc.ts`: remove the `@adonisjs/auth/auth_provider` provider.
  - `start/kernel.ts`: remove `initialize_auth_middleware` and `silent_auth_middleware` from `router.use`, and the `guest` / `auth` named middleware.
  - `start/routes.ts`: remove the signup, login, logout, and dashboard route groups.
  - `tests/bootstrap.ts`: remove the `authBrowserClient` plugin.
  - Keep `@adonisjs/session` and `@adonisjs/shield`; flash messages and CSRF protection still depend on them.
- [ ] **1.3 Remove Lucid (DuckDB replaces it):**
  - Uninstall the packages: `npm uninstall @adonisjs/lucid better-sqlite3`, and drop `better-sqlite3` from `allowScripts` in `package.json`.
  - Delete `config/database.ts`, `database/schema.ts`, `database/schema_rules.ts`, and `database/migrations/`.
  - `adonisrc.ts`: remove `@adonisjs/lucid/commands` and `@adonisjs/lucid/database_provider`.
  - `tests/bootstrap.ts`: remove the `dbAssertions` plugin.
  - Keep `luxon`; the kit's `start/validator.ts` still uses it.
- [ ] **1.4 Configure Frontend Shell (`resources/views/components/layouts/main.edge`):**
  - Build `main.edge` from the `<head>` of the kit's `marketing.edge`: `@vite(['resources/css/app.css', 'resources/js/app.js'])` loads the kit's stylesheet and its Alpine.js bundle. No CDN `<script>` or `<link>` tags.
  - Set up the dark space-telemetry theme by rendering `<html data-theme="dark">` by default and adjusting the kit's color tokens in `app.css` (`--paper`, `--card`, `--ink`, `--line`). Use `var(--mono)` for numeric readouts. Keep the kit's `themeToggle` component.
  - Use the kit's `edge-iconify` Lucide icons for UI glyphs (e.g., `@svg('lucide:satellite')`, `@svg('lucide:map-pin')`).
- [ ] **1.5 Wire DuckDB into the App Lifecycle (`node ace make:provider duckdb`):**
  - `register()`: bind `DuckDbService` as a container singleton.
  - `start()`: `DuckDBInstance.create(':memory:')`, connect, `SET file_search_path = '<app.makePath()>'`, then run `database/schema.sql` and `database/seed.sql` inside one `BEGIN … COMMIT`. Each file is a single `connection.run(sql)` call, because `run()` without parameters executes every statement in the string.
  - `shutdown()`: `connection.closeSync()`.
  - `DuckDbService.all<T>(sql, params)` wraps `connection.runAndReadAll(sql, params).getRowObjectsJS()` with named `$param` bindings and structured error logging.
  - **Why in memory:** DuckDB locks a database file to one process, so while `node ace serve` holds `analog.duckdb`, no other process (such as a seed command) can open it, even read-only. The data is fully derived from the seed CSVs and the app never writes, so rebuilding at boot takes a few milliseconds and avoids the lock.
  - **Gotcha:** `BIGINT` results such as `count(*)` come back as JS `bigint` (`3n`). Cast them to `INTEGER` in SQL before passing rows to Edge.

---

### Phase 2: NASA Data Curation & DuckDB Schema/Seed Files (Hours 3–9)
**Objective:** Construct the normalized dataset combining planetary targets (Moon/Mars Trek) and terrestrial candidates (NASA EMIT, NASADEM, MODIS), and define the DuckDB schema and seed SQL that load it.

- [ ] **2.1 Curate Planetary Reference Dataset (`database/seeds/planetary_references.csv`):**
  - Extract 6 Lunar sites (e.g., *Shackleton Crater Rim*, *Malapert Massif*, *Marius Hills Skylight*, *Connecting Ridge*, *Haworth Crater*, *Aristarchus Plateau*) and 6 Martian sites (e.g., *Jezero Crater Delta*, *Arcadia Planitia Ice Sheet*, *Olympus Mons Aureole*, *Mawrth Vallis Clay Unit*, *Valles Marineris Coprates Chasma*, *Elysium Planitia Lava Tubes*).
  - Record raw metrics (`slope_deg`, `roughness_m`, `temp_mean_c`, `fe_ti_index`, `volatile_index`) and Min-Max normalized vectors (`[0.0 - 1.0]`).
- [ ] **2.2 Curate Earth Analog Candidate Dataset (`database/seeds/earth_candidates.csv`):**
  - Compile 40–60 terrestrial sites filtered by `NDVI < 0.10` (barren terrain), mixing famous calibration sites (Devon Island, McMurdo Dry Valleys, Atacama Pajonales) with **lesser-known high-value discoveries** (e.g., *Askja Caldera Pumice Field*, *Salar de Gorbea Acidic Flats*, *Lunar Crater Volcanic Field Nevada*, *Pinacate Shield Volcanoes*, *Dallol Hydrothermal Field*, *Qaidam Basin Yardangs*, *Lava Beds National Monument TubeX Site*, *Lonar Basaltic Impact Crater*).
  - Map NASA EMIT mineral group abundances (`hematite`, `goethite`, `gypsum`, `kaolinite`, `basalt/olivine`), NASADEM slope/roughness, MODIS surface temperature extremes, and operational test tags (`|`-separated in one column).
- [ ] **2.3 Write the Schema (`database/schema.sql`):**
  - `CREATE TYPE world AS ENUM ('MOON', 'MARS');` so invalid worlds are rejected at insert.
  - `CREATE TABLE planetary_references (…)` and `CREATE TABLE earth_candidates (…)` with `slug VARCHAR PRIMARY KEY`, `NOT NULL` on required columns, `lat` / `lon` range `CHECK`s, raw metrics, normalized `norm_*` columns, `BOOLEAN` flags (`has_lava_tube`, `has_permafrost_ice`), and `tags VARCHAR[]`.
  - Use `DOUBLE`, not `FLOAT`, for metrics; `FLOAT` shows rounding noise such as `90.69999694824219` in scores.
  - Add `CHECK (norm_x BETWEEN 0 AND 1)` on every normalized column. These are the normalization verification checks: a bad CSV row fails boot with an error naming the table and column.
- [ ] **2.4 Write the Seed (`database/seed.sql`):**
  - `INSERT INTO earth_candidates SELECT …, string_split(tags, '|') FROM read_csv('database/seeds/earth_candidates.csv');` and the same for `planetary_references`. Paths resolve through `file_search_path`, so they work in dev and in the production build.
  - Both SQL files are plain DuckDB SQL. To explore the data, run them in the DuckDB CLI from the project root (`.read database/schema.sql`, then `.read database/seed.sql`).
  - Add `database/**/*.sql` and `database/seeds/*.csv` to `metaFiles` in `adonisrc.ts` so `node ace build` copies them.

---

### Phase 3: Hypermedia UI & 5-Step Journey Wiring (Hours 9–18)
**Objective:** Build the server-rendered Edge views and partials. Alpine.js, which the kit already bundles, fetches the partials and swaps them into the page, so every user action updates the UI without a page reload.

- [ ] **3.1 Add a Partial-Swap Helper (`resources/js/app.js`):**
  - Register an `Alpine.magic('swap', …)` helper (about 15 lines) that `fetch`es an Edge partial URL and replaces a target element's `innerHTML`. Alpine's mutation observer initializes any Alpine markup inside the new HTML automatically.
  - Track a shared `loading` flag in an `Alpine.store('ui')` to drive skeleton loaders.
  - All partial endpoints are read-only `GET` routes under `/partials/*`, so the helper needs no CSRF token.
- [ ] **3.2 Build Step 1 & 2 Controls (`partials/reference_list.edge` & `partials/reference_preview.edge`):**
  - Wire radio buttons for **Moon** and **Mars** with `@change="$swap('/partials/references?world=MOON', '#reference-selector')"`.
  - When a specific region is selected (`$swap('/partials/reference-preview?referenceId=…', '#reference-preview')`), render a telemetry summary card showing the target's LOLA/MOLA elevation, slope, Diviner/TES temperature, and primary mission objective.
- [ ] **3.3 Build Step 3 & 4 Controls (Terrain Weight Sliders & Live Trigger):**
  - Create native `<input type="range">` sliders (`0 = Ignore` to `5 = Critical`) for Slope, Roughness, Mineralogy, Volatiles, and Thermal Extremes.
  - The discovery form uses `@submit.prevent` to call `$swap('/partials/discover?' + new URLSearchParams(new FormData($el)), '#results')`.
  - Add Quick Mission Preset buttons via Alpine.js (e.g., *"Artemis ISRU Ice Mining"*, *"Lunar Lava Tube Habitat"*, *"Mars Rover Mobility Test"*) that auto-populate slider weights and call `$refs.discoveryForm.requestSubmit()`.
- [ ] **3.4 Build Step 5 Ranked Output (`partials/ranked_results.edge`):**
  - Render top Earth candidate cards ordered by `total_score DESC`.
  - Include horizontal progress bars for each of the 5 dimensions so judges immediately see *why* a region matched (e.g., *96% Mineralogy Match via NASA EMIT*, *91% Slope Match via NASADEM*).
  - Display a "Physical Limits & Discrepancies" pill on each card (e.g., *"1g Gravity (vs 0.16g Moon) • Breathable Atmosphere • Seasonal Precipitation"*).

---

### Phase 4: Server-Rendered Map Snapshots (Hours 18–26)
**Objective:** Show the Earth analog locations and NASA orbital imagery without a client map library. The server builds the NASA image URLs and computes marker positions itself.

- [ ] **4.1 Build `MapSnapshotService` (`app/services/map_snapshot_service.ts`):**
  - Given a bounding box, build a NASA GIBS WMS `GetMap` URL (`EPSG:4326`, fixed width/height, `image/jpeg`). WMS 1.3.0 expects the `EPSG:4326` `BBOX` in lat/lon axis order.
  - Project each candidate's lat/lon to `left %` / `top %` inside that box. EPSG:4326 imagery is equirectangular, so the projection is a linear interpolation.
  - For the planetary panel, compute the Moon/Mars Trek WMTS tile row/column that contains the reference site and return that tile URL.
- [ ] **4.2 Render `partials/analog_map.edge` with Every Discovery Result:**
  - Show a world overview image with absolutely positioned, color-coded similarity pins (score bands map to CSS classes).
  - Show an inset zoomed to the #1 ranked site (±2° box), replacing a client-side `flyTo`. Clicking a card or pin calls `$swap('/partials/map?candidateId=…', '#map-inset')` to re-center the inset.
- [ ] **4.3 Add NASA GIBS Layer Switcher:**
  - Alpine buttons switch the snapshot `src` between GIBS layers (VIIRS True Color, MODIS Land Surface Temperature, ASTER GDEM Elevation) for the matched Earth analog site. The service pre-builds one URL per layer.

---

### Phase 5: DuckDB Similarity & Explainability Engine (Hours 26–32)
**Objective:** Implement the parameterized SQL scoring engine that calculates both overall rank and per-feature contribution percentages.

- [ ] **5.1 Implement Weighted Similarity SQL in `AnalogSearchService`:**
  - Run the query through `DuckDbService.all(sql, { w1, w2, w3, w4, w5, ref })` using named `$w1 … $ref` parameters.
  - Compute per-dimension closeness: `1.0 - ABS(earth.norm_x - ref.norm_x)`.
  - Compute weighted aggregate score normalized by the sum of active user weights (`NULLIF($w1 + $w2 + $w3 + $w4 + $w5, 0)`).
  - Generate dynamic `primary_match_reason` and `limiting_factor` columns directly in SQL using `CASE WHEN` expressions.
- [ ] **5.2 Add Hard Constraint Filters (Optional Toggles):**
  - Support boolean filters for specific operational needs: `has_lava_tube`, `has_permafrost_ice`, or `slope_deg <= 15` (for lunar lander touchdown safety).
- [ ] **5.3 Validate Input Parameters (`app/validators/discovery_validator.ts`):**
  - Use VineJS (bundled with Adonis) to ensure `world` is `'MOON' | 'MARS'` and weights are bounded between `0` and `5`.
  - Lucid's `exists` rule is gone, so check that `referenceId` exists with a custom rule (`vine.createRule`) that queries `planetary_references` through `DuckDbService`.

---

### Phase 6: Deep-Dive Comparison Modal & Polish (Hours 32–40)
**Objective:** Add scientific rigor for hackathon judges by providing a side-by-side comparison modal and exportable mission brief.

- [ ] **6.1 Side-by-Side Comparison Modal (`GET /partials/compare/:referenceId/:candidateId`):**
  - Clicking "Inspect Scientific Match" on any Earth card swaps the partial into an Alpine-controlled modal (`x-show`, closes on `Esc`/backdrop). It compares raw planetary orbital numbers against terrestrial remote-sensing numbers, complete with dataset citations (`LRO LOLA`, `MRO CRISM`, `ISS EMIT L2B`, `NASADEM`).
- [ ] **6.2 Mission Field-Test Recommendation Generator:**
  - Based on the highest-scoring dimensions, output specific hardware/protocol tests suited for that site (e.g., *"Recommended for testing TRIDENT regolith drill bit wear and ground-penetrating radar calibration"*).
- [ ] **6.3 UI/UX & Performance Audit:**
  - Verify the DuckDB query execution time indicator (`Query executed in 4.2 ms across 50 terrestrial grids`) is displayed in the UI header.
  - Ensure zero layout shift during partial swaps using fixed-size skeleton loaders driven by the `ui.loading` store.

---

### Phase 7: Deployment, Demo Verification & Pitch Prep (Hours 40–48)
**Objective:** Package the application for live evaluation and finalize the Space Apps submission artifacts.

- [ ] **7.1 Production Build & Containerization:**
  - Verify `node ace build` bundles assets cleanly and copies `database/*.sql` and `database/seeds/*.csv` (via `metaFiles`). The DuckDB database is rebuilt in memory on every boot, so no database file is deployed.
  - Deploy to a Node.js 24+ host (Railway, Fly.io, or Render).
- [ ] **7.2 Final Submission Checklist:**
  - Record a 30-second/2-minute walkthrough demonstrating the 5-step flow: selecting Moon $\rightarrow$ picking Shackleton Crater $\rightarrow$ weighting Volatiles & Slope $\rightarrow$ running the DuckDB discovery query $\rightarrow$ inspecting a lesser-known Earth analog match on the map.
  - Document all NASA dataset citations (Solar System Treks, EMIT LP DAAC, NASADEM, MODIS, PDS Geosciences) in `README.md`.

---

## 4. Verification Criteria & Definition of Done

1. **End-to-End Hypermedia Flow:** Changing Reference World (Moon/Mars), Reference Region, or Terrain Weights updates the UI via Alpine-swapped Edge partials in under 50ms with zero full-page reloads.
2. **Explainable Scoring:** Every ranked Earth candidate displays both a composite match score (`0–100%`) and individual dimensional match scores backed by real physical units (`°C`, `degrees slope`, `EMIT mineral group`).
3. **Beyond Famous Sites:** Query results surface lesser-known terrestrial micro-regions alongside benchmark sites, explicitly noting both operational test utility and planetary simulation limits.
4. **No Authentication:** Every route is public. The app has no login, signup, users table, or `@adonisjs/auth` dependency.
5. **Minimal Stack:** `package.json` holds only the Hypermedia kit's own dependencies (minus `@adonisjs/auth`, `@adonisjs/lucid`, and `better-sqlite3`) plus `@duckdb/node-api`. No CDN scripts or styles appear in any Edge template.
