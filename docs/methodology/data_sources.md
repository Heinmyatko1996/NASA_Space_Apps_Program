# TerraTwin — Data Sources and Dataset Inventory

## 1. Overview

TerraTwin uses processed planetary terrain datasets to identify and rank
Earth terrain cells that resemble selected regions on the Moon and Mars.

The current prototype includes:

| Planet | Region | Role |
|---|---|---|
| Earth | Atacama | Earth analog candidate library |
| Mars | Jezero | Target terrain |
| Moon | South Pole | Target terrain |

The current Earth reference library contains only the Atacama Desert.
Results must therefore be interpreted as the best available analogs
within Atacama, not the best analogs worldwide.

## 2. Processed datasets

All paths below are relative to the project root.

### 2.1 Terrain features

File:

`data/processed/parquet/planet_terrain_features_5km_500m.parquet`

Purpose:

Stores harmonized terrain measurements for every processed grid cell.

| Planet | Region | Cells |
|---|---|---:|
| Earth | Atacama | 449 |
| Mars | Jezero | 439 |
| Moon | South_Pole | 400 |
| **Total** | | **1,288** |

Important columns:

- `planet`, `region`, `cell_id`: cell identity.
- `grid_col`, `grid_row`: local grid position.
- `longitude_center`, `latitude_center`: geographic center.
- `mean_elevation_m`: mean elevation.
- `elevation_p10_m`, `elevation_p90_m`: elevation percentiles.
- `robust_relief_m`: P90 minus P10 elevation.
- `elevation_range_m`: maximum minus minimum elevation.
- `mean_slope_deg`: mean slope.
- `slope_stddev_deg`: slope variability.
- `valid_pixel_fraction`: valid DEM pixel coverage.
- `valid_slope_pixel_fraction`: valid slope pixel coverage.
- `effective_source_resolution_m`: effective source resolution.
- `cell_size_m`: grid cell size.

### 2.2 Similarity features

File:

`data/processed/parquet/planet_similarity_features_5km_500m.parquet`

Purpose:

Stores terrain features and region-relative normalized measurements.

| Planet | Region | Eligible cells |
|---|---|---:|
| Earth | Atacama | 365 |
| Mars | Jezero | 360 |
| Moon | South_Pole | 324 |
| **Total** | | **1,049** |

Additional fields include:

- `relative_elevation_m`
- `relative_elevation_robust_z`
- `mean_slope_robust_z`
- `slope_variability_robust_z`
- `robust_relief_robust_z`
- Feature percentile fields.
- `normalization_reference_cell`

Important:

Region-relative normalized values describe a cell's position within
its own region. They must not be treated as directly comparable
cross-planet measurements.

The baseline analog ranking uses shared Earth-reference robust
standardization rather than comparing these region-relative Z scores.

### 2.3 Terrain analog rankings

File:

`data/processed/parquet/terrain_analog_rankings_5km_500m.parquet`

Purpose:

Stores the existing baseline nearest-neighbor comparisons between
eligible Moon/Mars target cells and eligible Earth candidate cells.

| Target | Target cells | Comparisons |
|---|---:|---:|
| Mars / Jezero | 360 | 131,400 |
| Moon / South Pole | 324 | 118,260 |
| **Total** | **684** | **249,660** |

Important columns:

- `target_planet`
- `target_region`
- `target_cell_id`
- `earth_region`
- `earth_cell_id`
- `distance`
- `slope_difference_z`
- `relief_difference_z`
- `variability_difference_z`
- `rank`

The current baseline uses three terrain characteristics:

1. Mean slope.
2. Robust relief.
3. Slope variability.

The distance is calculated as:

D = sqrt(
    slope_difference_z^2
    + relief_difference_z^2
    + variability_difference_z^2
)

A smaller distance indicates a closer match in the selected
standardized feature space. It is not a probability or percentage
of similarity.

## 3. Cell eligibility and coverage filtering

The baseline analysis requires both:

- `valid_pixel_fraction >= 0.95`
- `valid_slope_pixel_fraction >= 0.95`

The resulting eligible cell counts are:

| Planet | All terrain cells | Eligible cells | Excluded cells |
|---|---:|---:|---:|
| Earth | 449 | 365 | 84 |
| Mars | 439 | 360 | 79 |
| Moon | 400 | 324 | 76 |
| **Total** | **1,288** | **1,049** | **239** |

The difference between terrain and similarity dataset row counts
is therefore consistent with the coverage eligibility filter.

Excluded cells remain part of the terrain inventory but do not
participate in the current baseline ranking.

## 4. Dataset relationships

The primary cell-level join key is:

- `planet`
- `region`
- `cell_id`

The similarity dataset is a quality-filtered subset of the terrain
features dataset.

The ranking dataset contains target and candidate cell identifiers.
For result explanations, ranking records should be joined to terrain
features using the corresponding planet, region, and cell ID.

Earth candidate records use:

- `planet = 'Earth'`
- `region = 'Atacama'`

Target records currently use:

- `planet = 'Mars'`, `region = 'Jezero'`
- `planet = 'Moon'`, `region = 'South_Pole'`

## 5. Important interpretation limits

1. The current Earth candidate library covers Atacama only.
2. Rankings identify the best available Atacama candidates, not
   globally optimal Earth analogs.
3. The baseline ranking uses three selected terrain characteristics.
4. Harmonizing raster resolution does not make the original source
   datasets equally accurate or equally detailed.
5. Absolute elevation values may use different planetary vertical
   reference systems and should not be directly interpreted as
   equivalent physical elevations.
6. Terrain similarity alone does not establish landing-site
   suitability or overall mission safety.

## 6. Source-of-truth policy

Processed Parquet files are the data source for the current prototype.

SQL files under `queries/` define the analytical queries used by
the website.

Markdown files under `docs/` document methodology, findings,
limitations, and query contracts.

The baseline ranking Parquet file is a precomputed result for the
current configuration. Interactive changes to selected features
or reference regions require configurable ranking calculations;
the baseline file does not automatically support those changes.

## 7. Similarity generation and normalization eligibility

The similarity feature generation process applies two separate
selection criteria.

### 7.1 Coverage eligibility

A terrain cell is included in the similarity dataset only when both
conditions are satisfied:

- `valid_pixel_fraction >= 0.95`
- `valid_slope_pixel_fraction >= 0.95`

This filter is applied in `scripts/build_similarity_features.py`.

The resulting population is 1,049 cells:

- Earth / Atacama: 365
- Mars / Jezero: 360
- Moon / South_Pole: 324

### 7.2 Normalization reference cells

After coverage filtering, the script calculates:

`cell_area_ratio = valid_area_m2 / cell_size_m^2`

It then sets:

`normalization_reference_cell = cell_area_ratio >= 0.50`

These reference cells are used to calculate region-wise robust
statistics, including medians and robust scales.

This is a separate selection from the 95% coverage eligibility filter.

A cell may be included in the similarity dataset while not being
selected as a normalization reference cell.

The normalization reference flag should not be interpreted as
the analog-ranking eligibility flag.

### 7.3 Normalization method

For each planet and region, the script calculates a reference
median and robust scale for each feature.

The robust scale uses:

`1.4826 * MAD`

If MAD is zero or unavailable, the implementation falls back
to IQR, then standard deviation, and finally 1.0.

These normalized features describe relative position within
each region. They are not the shared Earth-reference standardized
values used by the baseline cross-planet ranking.
