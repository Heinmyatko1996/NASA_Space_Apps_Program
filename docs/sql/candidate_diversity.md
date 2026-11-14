# Candidate Diversity API

## 1. Purpose

Measures how widely the best-ranked Earth analog candidates are distributed across the selected Earth reference region.

This endpoint supports the TerraTwin results page by explaining whether planetary target cells select many distinct Earth locations or repeatedly select a small number of locations.

SQL source:

`queries/api/get_candidate_diversity.sql`

## 2. Implementation

The SQL file registers a DuckDB table macro:

`get_candidate_diversity(...)`

The macro:

1. Selects rank-1 matches for the requested target world and region.
2. Counts how often each Earth candidate is selected.
3. Counts the total target cells and unique Earth candidates.
4. Calculates candidate diversity percentage.
5. Identifies the most frequently reused Earth candidate.
6. Calculates the reuse count and share of that candidate.

Each target cell contributes exactly one best-match candidate.

## 3. Parameters

| Parameter | Type | Description |
|---|---|---|
| `p_target_planet` | VARCHAR | Target world: `Moon` or `Mars` |
| `p_target_region` | VARCHAR | Target region: `South_Pole` or `Jezero` |
| `p_reference_region` | VARCHAR | Earth reference region, currently `Atacama` |

Example:

```sql
SELECT *
FROM get_candidate_diversity(
    'Moon',
    'South_Pole',
    'Atacama'
);
```

Register the macro by executing `queries/api/get_candidate_diversity.sql` once per DuckDB connection.

## 4. Output schema

| Column | Description |
|---|---|
| `target_planet` | Selected target world |
| `target_region` | Selected target region |
| `reference_region` | Earth reference region |
| `target_cell_count` | Number of target cells with a rank-1 match |
| `unique_candidate_count` | Number of distinct Earth candidate cells selected |
| `candidate_diversity_pct` | Unique candidate count divided by target cell count, multiplied by 100 |
| `max_candidate_reuse_count` | Highest number of target cells selecting the same Earth candidate |
| `most_reused_candidate_cell_id` | ID of the most frequently selected Earth candidate |
| `most_reused_candidate_region` | Region containing that candidate |
| `most_reused_candidate_count` | Number of target cells selecting that candidate |
| `most_reused_candidate_share_pct` | Percentage of target cells selecting that candidate |

## 5. Calculations

### Candidate diversity

```text
candidate_diversity_pct =
    unique_candidate_count / target_cell_count * 100
```

A higher value means that the target region's best matches are distributed across more distinct Earth cells.

### Most-reused candidate share

```text
most_reused_candidate_share_pct =
    most_reused_candidate_count / target_cell_count * 100
```

A higher value means that a larger proportion of target cells select the same Earth candidate.

## 6. Validated results

### Moon — South Pole

| Metric | Result |
|---|---:|
| Target cells | 324 |
| Unique candidates | 67 |
| Candidate diversity | 20.68% |
| Maximum reuse | 138 |
| Most reused candidate | `earth_atacama_atacama_r-7_c-3` |
| Most reused candidate share | 42.59% |

### Mars — Jezero

| Metric | Result |
|---|---:|
| Target cells | 360 |
| Unique candidates | 176 |
| Candidate diversity | 48.89% |
| Maximum reuse | 8 |
| Most reused candidate | `earth_atacama_atacama_r5_c1` |
| Most reused candidate share | 2.22% |

## 7. Frontend usage

Suggested results-page components:

### Candidate diversity indicator

Display `candidate_diversity_pct` as a percentage.

Suggested explanation:

"Percentage of distinct Earth candidate cells selected as the best match across all target cells."

### Candidate reuse indicator

Display:

- Most reused candidate cell ID
- Number of target cells selecting it
- Percentage of target cells selecting it

### Interpretation

The Moon result indicates that many target cells repeatedly select a small subset of Atacama cells.

The Mars result indicates a more distributed set of best-match candidates within the current Atacama reference library.

## 8. Scientific interpretation and limitations

Candidate diversity measures the distribution of rank-1 Earth candidate assignments. It does not measure terrain similarity.

Distance and diversity answer different questions:

- Distance: How closely do the terrain features match?
- Diversity: How many distinct Earth locations are selected?

The current reference library contains only Atacama. Therefore, these results describe diversity within Atacama, not across all Earth terrain.

Candidate diversity is also dependent on the target grid resolution, feature selection, normalization, and ranking method.

The results should not be interpreted as probabilities, geographic coverage percentages, or measures of landing-site suitability.

## 9. Data dependency

`data/processed/parquet/terrain_analog_rankings_5km_500m.parquet`

The current implementation summarizes the precomputed three-feature baseline rankings.
