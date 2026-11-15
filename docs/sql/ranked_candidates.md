# Ranked Candidates API

## Purpose

Returns the top-ranked Earth terrain analog candidates for one selected target terrain cell.

This query supports the TerraTwin **Analyze → Results** experience.

For example, after a user selects a Moon target cell, the frontend can display its closest matching Earth terrain cells, their ranking distances, coordinates, and terrain measurements.

## SQL source

`queries/api/get_ranked_candidates.sql`

## Implementation

The SQL file registers a DuckDB table macro:

`get_ranked_candidates(...)`

The macro reads the precomputed baseline ranking Parquet file and joins it with the terrain feature dataset to retrieve coordinates and feature measurements.

Execute the SQL file once per DuckDB connection before calling the macro.

## Parameters

| Parameter | Type | Description |
|---|---|---|
| `p_target_planet` | VARCHAR | Target world, currently `Moon` or `Mars` |
| `p_target_region` | VARCHAR | Target region, such as `South_Pole` or `Jezero` |
| `p_target_cell_id` | VARCHAR | Selected target terrain cell ID |
| `p_reference_region` | VARCHAR | Earth reference region, currently `Atacama` |
| `p_top_n` | INTEGER | Maximum number of candidates to return |

Example:

```sql
SELECT *
FROM get_ranked_candidates(
    'Moon',
    'South_Pole',
    'moon_south_south_pole_r8_c4',
    'Atacama',
    10
);
```

This requests the ten highest-ranked Atacama candidates for one Moon target cell.

## Output schema

| Column | Description |
|---|---|
| `target_planet` | Target world |
| `target_region` | Target region |
| `target_cell_id` | Selected target cell ID |
| `target_longitude` | Target cell longitude |
| `target_latitude` | Target cell latitude |
| `target_mean_slope_deg` | Target mean slope |
| `target_robust_relief_m` | Target robust relief |
| `target_slope_stddev_deg` | Target slope variability |
| `reference_region` | Earth reference region |
| `candidate_cell_id` | Earth candidate cell ID |
| `candidate_longitude` | Candidate longitude |
| `candidate_latitude` | Candidate latitude |
| `candidate_mean_slope_deg` | Candidate mean slope |
| `candidate_robust_relief_m` | Candidate robust relief |
| `candidate_slope_stddev_deg` | Candidate slope variability |
| `distance` | Standardized Euclidean distance |
| `slope_difference_z` | Signed slope difference in shared Earth-reference robust-scale units |
| `relief_difference_z` | Signed robust-relief difference in shared Earth-reference robust-scale units |
| `variability_difference_z` | Signed slope-variability difference in shared Earth-reference robust-scale units |
| `rank` | Candidate rank, starting at 1 |

## Frontend usage

### Results table

Use the returned rows to display:

- Rank
- Candidate cell ID
- Distance
- Mean slope
- Robust relief
- Slope variability

Sort order is already determined by `rank`.

### Map

Use:

- `target_longitude`, `target_latitude` for the target marker.
- `candidate_longitude`, `candidate_latitude` for candidate markers.

The frontend can display the selected target and its ranked Earth candidates together.

### Candidate detail

The returned feature values can support a comparison panel showing target and candidate measurements side by side.

The signed feature differences can help explain why a candidate received its ranking.

## Data dependencies

| Dataset | Purpose |
|---|---|
| `terrain_analog_rankings_5km_500m.parquet` | Precomputed candidate rankings |
| `planet_terrain_features_5km_500m.parquet` | Target and candidate coordinates and terrain measurements |

## Scientific interpretation

`distance` is a standardized Euclidean distance based on three features:

1. Mean slope
2. Robust relief
3. Slope variability

A lower distance indicates a closer match under this particular feature set and normalization method.

It is not a probability, percentage similarity, or measure of landing-site safety.

The signed feature differences are expressed in shared Earth-reference robust-scale units. A positive difference means the target feature is higher than the Earth candidate feature.

## Important limitations

1. The current ranking dataset contains the validated baseline configuration.
2. The current Earth reference library contains only the Atacama region.
3. Changing the selected features requires recomputing rankings. This macro does not dynamically change the ranking features.
4. The results represent terrain similarity within the current study dataset, not the best possible analog anywhere on Earth.
5. The macro returns results for one target cell per call.

## Backend integration notes

The backend should:

1. Open or initialize its DuckDB connection.
2. Execute `get_ranked_candidates.sql` to register the macro.
3. Call the macro with the five parameters.
4. Convert the returned rows into the API response format.

The macro should be registered once per connection, not repeatedly for every user request.

For production deployment, ensure the Parquet paths are valid in the backend runtime or replace them with paths appropriate to the deployed data layout.
