# User Journey: Planetary Analog Discovery Engine

**Live app:** https://planetary-analog-finder-eight.vercel.app
**Event:** 2026 NASA Space Apps Challenge, *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*

The app answers one question: **which places on Earth have terrain most like a given region of the Moon or Mars?** It splits each region into 5 km grid cells, describes every cell by its terrain shape, and ranks Earth cells by how close their terrain is to each Moon or Mars cell.

Everything happens on one page, in four stages: **Explore → Configure → Analyze → Understand**. These follow the stages in Hein's `docs/website_integration.md`.

```text
 Explore            Configure             Analyze               Understand
 ───────            ─────────             ───────               ──────────
 Baseline cards  →  World, region,     →  run_discovery     →  Run summary, cell grid,
 Earth overview     features, top-N       ranks every cell      candidates, map,
 map                (or a preset)         (~300–420 ms)         match detail
```

---

## 1. Explore: see what the tool does

When the page loads, before the user configures anything, it shows:

- **Two baseline example cards**, one for **Moon · South Pole** and one for **Mars · Jezero**. Both come from Hein's precomputed ranking, which compares all three terrain features against the Atacama reference. Each card shows:
  - **Target cells:** the number of cells with enough data to rank (Moon 324, Mars 360).
  - **Median best distance:** each target cell's closest Earth match, summarized across cells, with the range (Moon 1.82, Mars 0.17).
  - **Candidate diversity:** how many different Earth cells are a best match, relative to the number of target cells (Moon 20.7%, Mars 48.9%).
  - **Closest target cell** and its top Earth candidates, each with its distance.
  - A **Use this setup** button. It fills the form with that world, region, and reference, selects all three features, and runs discovery right away.
- **An Earth overview map:** a full-globe NASA Blue Marble image with each Earth reference region marked, so users can see where on Earth the candidates come from.

**Why this stage exists:** a judge or first-time visitor sees real results within seconds and learns what "distance" and "diversity" mean before choosing anything.

## 2. Configure: choose what to compare

The **Configure** form has five inputs:

| Input | Choices | Notes |
|---|---|---|
| **Target world** | Moon, Mars | Switching the world swaps in that world's regions without reloading the page. |
| **Target region** | Moon: South Pole (324 cells). Mars: Jezero (360 cells). | The list comes from the data catalog, so new regions appear automatically. |
| **Earth reference region** | Atacama (365 cells) | Atacama is currently the only Earth region. A hint below the field says that results are the best analogs *within Atacama*, not worldwide. |
| **Terrain features** (at least one) | **Mean slope** (degrees): average slope in a cell. **Robust relief** (metres): elevation spread between the 90th and 10th percentiles. **Slope variability** (degrees): standard deviation of slope. | Each feature shows its unit and a one-line description. |
| **Earth candidates per target cell** | 1 to 25 (default 10) | How many ranked Earth cells to keep for each target cell. |

**Presets** set the feature checkboxes and run discovery in one click:

| Preset | Features | Use case |
|---|---|---|
| Full terrain (baseline) | All three | General terrain likeness |
| Rover traverse | Mean slope, slope variability | Driving and obstacle conditions |
| Landing zone survey | Mean slope | Touchdown steepness |

Invalid input, such as no features selected, an unknown region, or top-N out of range, never reaches the database. A **"Check the settings and try again"** notice replaces the results and lists each problem (HTTP 422).

## 3. Analyze: run the ranking

Pressing **Run discovery** sends the form to the server. The page does not reload: the results area swaps in place, and "Ranking terrain…" shows while the request runs. On the server, Hein's `run_discovery` SQL macro:

1. Keeps only **eligible cells**: at least 95% valid elevation pixels and at least 95% valid slope pixels.
2. **Standardizes** each selected feature against the Earth reference region, using its median and robust spread (1.4826 × MAD), so features measured in degrees and metres can be combined.
3. Computes the **distance** between every target cell and every Earth cell: `sqrt(Σ difference²)` over the selected features.
4. **Ranks** the Earth cells for each target cell and keeps the top N.

A full run compares, for example, 324 Moon cells with 365 Earth cells and takes about 300–420 ms. The results header shows this as `run_discovery: 378 ms · 324 target cells × 365 Earth cells`. A repeated query comes back from a cache and is labeled `cached`.

The browser address bar updates to the full query (for example `/?world=Moon&region=South_Pole&...`), so **every result is a shareable link**. Opening the link renders the same result on the server, even without JavaScript.

## 4. Understand: read and inspect the results

### 4.1 Run summary

The top of the results restates the configuration (target, reference, features, top-N, query time). Distances from different feature selections cannot be compared, so the configuration always appears next to the numbers. Stat tiles follow:

- **Target cells ranked:** cells with at least 95% data coverage.
- **Median best distance:** labeled "lower = closer · not a percentage".
- **Best distance range:** with the middle half (25th to 75th percentile).
- **Candidate diversity:** how many unique Earth cells are a best match.
- **Most reused Earth cell:** the Earth cell that is the best match for the most target cells, with its share.

### 4.2 Target cell grid

A map-like grid of the target region, north up, with one square per 5 km cell:

- Cells are shaded into four bands relative to this run: **Closest 25%**, **25–50%**, **50–75%**, **Farthest 25%**.
- Cells with less than 95% data coverage are hatched as **Excluded**.
- Hovering over or focusing a cell shows a tooltip with its best distance.
- A collapsible **"Closest N target cells"** table lists the same information in rows, as an accessible alternative to the grid.

**Selecting a cell** loads that cell's Earth candidates beside the grid and updates the URL with `&cell=…`. The best-matching cell is selected automatically after each run.

### 4.3 Earth candidates for the selected cell

- **Target cell header:** the cell ID, world and region, coordinates, and its terrain values. Features left out of this run are dimmed.
- **"Where the matches are" map:** a NASA GIBS satellite image of the Earth reference region. A dashed outline shows the region's cell coverage, and numbered markers show each candidate's rank. Clicking a marker or a card highlights both. The image layer can be switched between **True color** (VIIRS), **Surface temperature** (MODIS 8-day land surface temperature, with legend), and **Elevation** (ASTER GDEM shaded relief). These layers are context only; the ranking uses terrain features alone.
- **Candidate cards**, ranked: rank, Earth cell ID, distance, region, coordinates, and a **signed bar per selected feature**. Each bar shows the target-minus-Earth difference in standardized units. Bars to one side mean the target is higher, bars to the other mean it is lower, and longer bars add more to the distance. These bars show *which feature drove the distance*.

### 4.4 Match detail ("Inspect match")

**Inspect match** on any card opens a modal dialog for that one match. Esc or a click on the backdrop closes it, and focus returns to the link. The URL gains `&inspect=N`, so the open dialog is also shareable. The dialog shows:

- **Header:** match rank, both locations, and the distance ("lower = closer").
- **Both places side by side:**
  - The target cell's ID, coordinates, data coverage, and a mini grid of its region with the cell ringed.
  - The Earth cell's ID, coordinates, data coverage, and its position on the reference-region satellite image.
- **Terrain values table:** original values with units for target and Earth (mean slope °, robust relief m, slope variability °). Features not used in this run are marked "not compared in this run". **Mean elevation** is listed but flagged as *not comparable across bodies: different vertical reference systems*.
- **Differences, target minus Earth:** the same signed feature bars as on the card.
- **Field-test ideas:** one per selected feature, ordered by how close the match is on that feature, with the closest feature flagged:
  - Mean slope → *Lander touchdown and slope traverse trials*
  - Slope variability → *Rover suspension and obstacle trials*
  - Robust relief → *EVA navigation trials*

  Each idea ends with the caveat: *"Based on terrain shape only. Gravity, regolith, temperature, and radiation are not compared."*
- **Source data citations** (Earth SRTM, Moon LRO LOLA, Mars MGS MOLA, all resampled to a common 500 m grid) and a **link to this match**.

### 4.5 Limitations, shown with every result

Every result ends with a **"Read these results with care"** panel:

1. The Earth reference library covers the **Atacama Desert only**, so these are the best analogs within Atacama, not worldwide.
2. **Distance is a standardized terrain difference. Lower is closer.** It is not a probability or a percentage, and distances from different feature selections can't be compared.
3. **Elevation is not compared** across bodies, because each body uses a different vertical reference system.
4. **Terrain shape alone doesn't establish landing-site safety.** Gravity, regolith, temperature, and radiation are not compared.

---

## Demo path (about 2 minutes)

1. Open the live app. Point out the two **Explore** cards and the Earth overview map.
2. On **Moon · South Pole**, press **Use this setup** to run discovery with all three features.
3. Read the run summary: query time, median best distance, candidate diversity.
4. In the grid, select the darkest (closest) cell. Its Atacama candidates and the map markers appear.
5. On candidate **#1**, press **Inspect match**. Walk through the terrain values, the feature bars, and the field-test ideas.
6. Switch to the **Landing zone survey** preset and show how the ranking changes when only mean slope is compared.

**One-sentence explanations to rehearse:**
- *Distance:* "A standardized terrain difference: lower is closer, and it is not a percentage."
- *Coverage:* "Atacama is the only Earth reference so far, so these are the best analogs within Atacama, not worldwide."

## Pages and endpoints behind the journey

| Stage | Request | Returns |
|---|---|---|
| Page load, or opening a shared link | `GET /?world=…&region=…&reference=…&features[]=…&topN=…[&cell=…][&inspect=N]` | The full page, with results, the selected cell, and an open detail dialog when those parameters are present |
| Switching the world | `GET /partials/regions?world=…` | Region choices for that world |
| Run discovery | `GET /partials/discover?…config` | Run summary, cell grid, and candidates for the best cell |
| Selecting a cell | `GET /partials/cells/:cellId?…config` | Candidates and map for that cell |
| Inspect match | `GET /partials/candidates/:cellId/:rank?…config` | The match detail dialog content |

All routes are public `GET` requests: the app has no login. Invalid settings return **422** with the problems notice, and an unknown cell or rank returns **404**.
