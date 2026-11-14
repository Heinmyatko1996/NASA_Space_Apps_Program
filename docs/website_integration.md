# TerraTwin Website Integration Guide

## 1. Purpose

This document describes how the website, backend, DuckDB SQL operations, and SQL documentation fit together to provide the complete TerraTwin user journey.

The website journey is:

1. Explore
2. Configure
3. Analyze
4. Understand

## 2. Website pages and SQL operations

| Website page | SQL operation | SQL file | Documentation |
|---|---|---|---|
| Explore | Catalog | queries/api/get_catalog.sql | docs/sql/catalog.md |
| Explore | Baseline ranked candidates | queries/api/get_ranked_candidates.sql | docs/sql/ranked_candidates.md |
| Explore | Baseline discovery summary | queries/api/get_discovery_summary.sql | docs/sql/discovery_summary.md |
| Explore | Baseline candidate diversity | queries/api/get_candidate_diversity.sql | docs/sql/candidate_diversity.md |
| Configure | Catalog | queries/api/get_catalog.sql | docs/sql/catalog.md |
| Configure | Reference regions | queries/api/get_reference_regions.sql | docs/sql/reference_regions.md |
| Analyze | Dynamic discovery | queries/discovery/run_discovery.sql | docs/sql/run_discovery.md |
| Understand | Dynamic discovery results | queries/discovery/run_discovery.sql | docs/sql/run_discovery.md |

## 3. User journey

### Page 1: Explore

Purpose:
Show users what TerraTwin does before they configure a new discovery.

Display:
- Moon / South Pole example
- Mars / Jezero Crater example
- Example ranked Earth candidates
- Example distance summaries
- Example candidate diversity

Use the precomputed baseline results for these examples.

### Page 2: Configure

Purpose:
Allow users to select the parameters for a new discovery.

Inputs:
- Target planet
- Target region
- Earth reference region
- Terrain features
- Number of candidates per target cell

Load available worlds, regions, and features using get_catalog.

Load available Earth reference regions using get_reference_regions.

### Page 3: Analyze

Purpose:
Calculate terrain analog rankings from the selected configuration.

Execute run_discovery with the submitted configuration.

The macro:
- Filters eligible terrain cells.
- Calculates Earth reference medians and robust scales.
- Standardizes selected terrain features.
- Calculates pairwise distances.
- Ranks Earth candidates for every target cell.

The top-N parameter applies independently to each target cell.

### Page 4: Understand

Purpose:
Help users interpret the discovery results.

Display:
- Ranked Earth candidates
- Distance values
- Feature differences
- Target and candidate terrain characteristics
- Geographic locations on a map
- Summary statistics
- Candidate reuse and diversity

Important:
Custom discovery results must be used for all custom-result explanations.

The existing get_ranked_candidates, get_discovery_summary, and get_candidate_diversity operations read the precomputed baseline ranking. They must not be presented as custom-discovery results without adaptation.

For custom discovery:
- Calculate summary metrics from the full dynamic ranking.
- Calculate diversity from the full dynamic ranking.
- Join terrain feature data to retrieve coordinates and original feature values.
- Preserve the discovery configuration so results can be reproduced.

## 4. Backend API contract

### POST /api/discoveries

Request:

    {
      "targetPlanet": "Moon",
      "targetRegion": "South_Pole",
      "referenceRegion": "Atacama",
      "featureIds": [
        "mean_slope_deg",
        "robust_relief_m"
      ],
      "topN": 10
    }

Response:

    {
      "discoveryId": "demo-discovery-001",
      "configuration": {
        "targetPlanet": "Moon",
        "targetRegion": "South_Pole",
        "referenceRegion": "Atacama",
        "featureIds": [
          "mean_slope_deg",
          "robust_relief_m"
        ],
        "topN": 10
      },
      "results": [
        {
          "targetCellId": "moon_south_south_pole_r8_c4",
          "candidates": [
            {
              "rank": 1,
              "earthCellId": "earth_atacama_atacama_r-7_c-3",
              "earthRegion": "Atacama",
              "distance": 4.4972240634540315,
              "featureDifferences": {
                "meanSlopeZ": 1.3614885335692246,
                "robustReliefZ": 4.286183996268652,
                "slopeVariabilityZ": null
              }
            }
          ]
        }
      ]
    }

This is the proposed frontend/backend contract. It is not the direct SQL output schema.

## 5. DuckDB integration

Register SQL macros when initializing the DuckDB connection.

Required operations:

- queries/api/get_catalog.sql
- queries/api/get_reference_regions.sql
- queries/api/get_ranked_candidates.sql
- queries/api/get_discovery_summary.sql
- queries/api/get_candidate_diversity.sql
- queries/discovery/run_discovery.sql

Use parameterized SQL execution.

Do not concatenate user-provided values into SQL strings.

The backend should translate SQL errors into understandable API validation responses.

## 6. Important scientific limitations

- The current Earth reference library contains Atacama only.
- Results represent the best available analog within the configured Earth reference dataset.
- Distance is standardized Euclidean distance, not probability or percentage similarity.
- Distances from different feature configurations are not directly comparable.
- Cells with less than 95% valid DEM or slope coverage are excluded.
- Absolute elevation is not directly compared across planetary bodies because their vertical reference systems differ.

## 7. Documentation directory

SQL documentation:

- docs/sql/catalog.md
- docs/sql/reference_regions.md
- docs/sql/run_discovery.md
- docs/sql/ranked_candidates.md
- docs/sql/discovery_summary.md
- docs/sql/candidate_diversity.md

Central website integration:

- docs/website_integration.md

## 8. Implementation priority

1. Complete the Configure page using catalog and reference-region operations.
2. Connect the Analyze page to run_discovery.
3. Display dynamic candidate rankings.
4. Enrich candidates with coordinates and original terrain feature values.
5. Add dynamic summary and diversity calculations.
6. Add maps and feature comparison visualizations.
