# run_discovery

## Purpose

Dynamically rank Earth terrain cells against a selected Moon or Mars target region using a configurable set of terrain features.

Unlike the precomputed baseline ranking, this operation recalculates feature normalization, pairwise distances, and candidate ranks based on the features selected by the user.

**SQL file:** `queries/discovery/run_discovery.sql`

**SQL object:** `run_discovery` (DuckDB table macro)

## Parameters

| Parameter | Type | Description | Example |
|---|---|---|---|
| `p_target_planet` | VARCHAR | Target world. Currently supports `Moon` or `Mars`. | `Moon` |
| `p_target_region` | VARCHAR | Target region identifier. | `South_Pole` |
| `p_reference_region` | VARCHAR | Earth reference region used for candidate matching. | `Atacama` |
| `p_feature_ids` | VARCHAR[] | Selected terrain feature IDs. At least one valid, unique feature is required. | `['mean_slope_deg', 'robust_relief_m']` |
| `p_top_n` | INTEGER | Maximum number of ranked Earth candidates returned per target cell. Must be greater than zero. | `10` |

## Supported features

| Feature ID | Description | Unit |
|---|---|---|
| `mean_slope_deg` | Mean terrain slope | Degrees |
| `robust_relief_m` | Robust elevation relief (P90 − P10) | Metres |
| `slope_stddev_deg` | Standard deviation of terrain slope | Degrees |

All three features are selected by default in the baseline configuration.

## SQL usage

```sql
SELECT *
FROM run_discovery(
    'Moon',
    'South_Pole',
    'Atacama',
    [
        'mean_slope_deg',
        'robust_relief_m',
        'slope_stddev_deg'
    ],
    10
)
WHERE target_cell_id = 'moon_south_south_pole_r8_c4'
ORDER BY rank;