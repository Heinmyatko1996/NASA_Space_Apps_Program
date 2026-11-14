# Discovery Summary API

## Purpose

Returns aggregate statistics for the best Earth analog match for every eligible target cell in a selected planetary region.

This supports the summary section of the TerraTwin results page.

## SQL source

`queries/api/get_discovery_summary.sql`

## Implementation

The SQL file registers a DuckDB table macro:

`get_discovery_summary(...)`

It reads the precomputed baseline ranking Parquet file and selects only rank-1 candidates.

Each target cell therefore contributes exactly one best-match distance to the summary.

## Parameters

| Parameter | Type | Description |
|---|---|---|
| `p_target_planet` | VARCHAR | Target world, such as `Moon` or `Mars` |
| `p_target_region` | VARCHAR | Target region, such as `South_Pole` or `Jezero` |
| `p_reference_region` | VARCHAR | Earth reference region, currently `Atacama` |

Example:

```sql
SELECT *
FROM get_discovery_summary(
    'Moon',
    'South_Pole',
    'Atacama'
);
```

## Output schema

| Column | Description |
|---|---|
| `target_planet` | Selected target world |
| `target_region` | Selected target region |
| `reference_region` | Earth reference region |
| `target_cell_count` | Number of target cells with a rank-1 match |
| `min_best_distance` | Lowest best-match distance |
| `q25_best_distance` | 25th percentile of best-match distances |
| `median_best_distance` | Median best-match distance |
| `q75_best_distance` | 75th percentile of best-match distances |
| `max_best_distance` | Highest best-match distance |
| `mean_best_distance` | Mean best-match distance |

## Frontend usage

The frontend can use these values to display:

- Number of target cells analyzed
- Median best-match distance
- Best and worst best-match distances
- A distribution chart using Q25, median, and Q75

Suggested chart: a box-and-whisker style summary or a simple distribution visualization built from the underlying per-cell results.

## Scientific interpretation

The statistics summarize the distance between each target cell and its single best-ranked Earth candidate.

Distance is a standardized Euclidean distance based on:

1. Mean slope
2. Robust relief
3. Slope variability

Lower distances indicate closer matches under this baseline method.

These values are not probabilities or percentages of similarity. They are not absolute scientific thresholds for terrain equivalence.

The summary describes the current Earth reference library, which contains the Atacama region only.

## Data dependency

`data/processed/parquet/terrain_analog_rankings_5km_500m.parquet`

## Important limitations

1. This endpoint summarizes the precomputed three-feature baseline.
2. It does not recompute rankings for custom feature selections.
3. Each target cell contributes only its rank-1 candidate.
4. The summary is conditional on the current Atacama reference region.
5. A missing result for a selected region should be treated as no available ranking data, not as a zero-distance result.
