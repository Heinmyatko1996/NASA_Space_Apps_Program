# get_candidate_details

## Purpose

Retrieve detailed terrain information for a selected Earth analog candidate and its corresponding Moon or Mars target cell.

This operation supports the website's Understand stage by providing geographic coordinates, original terrain measurements, standardized feature differences, and data coverage information.

**SQL file:** `queries/api/get_candidate_details.sql`

**SQL object:** `get_candidate_details` (DuckDB table macro)

## Parameters

| Parameter | Type | Description |
|---|---|---|
| p_target_planet | VARCHAR | Target world: Moon or Mars |
| p_target_region | VARCHAR | Target region |
| p_target_cell_id | VARCHAR | Selected target terrain cell |
| p_reference_region | VARCHAR | Earth reference region |
| p_feature_ids | VARCHAR[] | Selected terrain feature IDs |
| p_rank | INTEGER | Candidate rank to retrieve |

## Example

```sql
SELECT *
FROM get_candidate_details(
    'Moon',
    'South_Pole',
    'moon_south_south_pole_r8_c4',
    'Atacama',
    [
        'mean_slope_deg',
        'robust_relief_m'
    ],
    1
);
```

## Output fields

### Candidate identification

| Column | Description |
|---|---|
| target_cell_id | Target terrain cell ID |
| target_planet | Moon or Mars |
| target_region | Target region |
| earth_cell_id | Selected Earth candidate cell |
| earth_region | Earth reference region |
| rank | Candidate rank |
| distance | Standardized Euclidean distance |

### Geographic coordinates

| Column | Description |
|---|---|
| target_latitude | Target cell latitude |
| target_longitude | Target cell longitude |
| earth_latitude | Earth candidate latitude |
| earth_longitude | Earth candidate longitude |

Coordinates are geographic latitude and longitude in decimal degrees.

### Original terrain measurements

| Column | Description |
|---|---|
| target_mean_elevation_m | Target mean elevation |
| target_mean_slope_deg | Target mean slope |
| target_robust_relief_m | Target robust relief |
| target_slope_stddev_deg | Target slope variability |
| earth_mean_elevation_m | Earth mean elevation |
| earth_mean_slope_deg | Earth mean slope |
| earth_robust_relief_m | Earth robust relief |
| earth_slope_stddev_deg | Earth slope variability |

### Standardized feature differences

| Column | Description |
|---|---|
| slope_difference_z | Standardized mean-slope difference |
| relief_difference_z | Standardized robust-relief difference |
| variability_difference_z | Standardized slope-variability difference |

Unselected feature differences are NULL.

### Data coverage

| Column | Description |
|---|---|
| target_valid_pixel_fraction | Target DEM valid pixel fraction |
| earth_valid_pixel_fraction | Earth DEM valid pixel fraction |
| target_valid_slope_pixel_fraction | Target slope valid pixel fraction |
| earth_valid_slope_pixel_fraction | Earth slope valid pixel fraction |

## Website usage

This query supports the candidate detail view.

Recommended frontend components:

1. Map showing target and Earth candidate locations.
2. Terrain feature comparison charts.
3. Distance and ranking explanation.
4. Data coverage indicators.

The map should use the returned coordinates. Feature charts should use the original measurements, while standardized differences can explain how each feature influenced the ranking.

## Important limitations

- The query recalculates discovery rankings through run_discovery.
- The query retrieves one candidate rank for one target cell.
- Elevation values across different planetary bodies should not be interpreted as directly comparable because their vertical reference systems differ.
- Distance is not a probability or percentage of similarity.
- Current Earth reference coverage is limited to Atacama.

## Backend integration

Register both SQL macros on the DuckDB connection:

- queries/discovery/run_discovery.sql
- queries/api/get_candidate_details.sql

Execute get_candidate_details with parameterized inputs.

The returned row can be transformed into a JSON response for the frontend.
