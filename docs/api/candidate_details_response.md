# Candidate Details API Response

## Purpose

Define the JSON response returned by the backend when a user opens an individual Earth analog candidate.

The response combines:
- Target terrain information
- Earth candidate terrain information
- Geographic coordinates
- Ranking and distance
- Standardized feature differences
- Data coverage information
- Discovery configuration

## Source SQL

`queries/api/get_candidate_details.sql`

The query depends on:

`queries/discovery/run_discovery.sql`

## Response structure

The response contains four main objects:

| Object | Purpose |
|---|---|
| target | Target planetary terrain cell |
| candidate | Selected Earth analog cell |
| comparison | Ranking, distance, and feature differences |
| configuration | Reference region and selected features |

## Field definitions

### target and candidate

Both objects contain:

| Field | Type | Description |
|---|---|---|
| cellId | string | Terrain cell identifier |
| planet | string | Planetary body |
| region | string | Region identifier |
| location.latitude | number | Latitude in decimal degrees |
| location.longitude | number | Longitude in decimal degrees |
| terrain.meanElevationM | number | Mean elevation in metres |
| terrain.meanSlopeDeg | number | Mean slope in degrees |
| terrain.robustReliefM | number | P90 minus P10 elevation |
| terrain.slopeStddevDeg | number | Slope standard deviation |
| dataQuality.validPixelFraction | number | Valid DEM coverage fraction |
| dataQuality.validSlopePixelFraction | number | Valid slope coverage fraction |

### comparison

| Field | Type | Description |
|---|---|---|
| rank | integer | Candidate rank |
| distance | number | Standardized Euclidean distance |
| featureDifferences.meanSlopeZ | number or null | Standardized slope difference |
| featureDifferences.robustReliefZ | number or null | Standardized relief difference |
| featureDifferences.slopeVariabilityZ | number or null | Standardized slope variability difference |

### configuration

| Field | Type | Description |
|---|---|---|
| referenceRegion | string | Selected Earth reference region |
| selectedFeatures | array of strings | Feature IDs used in discovery |

## Example response

```json
{
  "target": {
    "cellId": "moon_south_south_pole_r8_c4",
    "planet": "Moon",
    "region": "South_Pole",
    "location": {
      "latitude": -88.414144232694,
      "longitude": 27.89727103094763
    },
    "terrain": {
      "meanElevationM": -2381.6746692854413,
      "meanSlopeDeg": 14.89184430732416,
      "robustReliefM": 1014.9337158203125,
      "slopeStddevDeg": 2.7630883607162655
    },
    "dataQuality": {
      "validPixelFraction": 1.0,
      "validSlopePixelFraction": 1.0
    }
  },
  "candidate": {
    "cellId": "earth_atacama_atacama_r-7_c-3",
    "planet": "Earth",
    "region": "Atacama",
    "location": {
      "latitude": -23.79339702646138,
      "longitude": -69.62265244593269
    },
    "terrain": {
      "meanElevationM": 1802.581200443995,
      "meanSlopeDeg": 12.984175248299735,
      "robustReliefM": 660.9049072265625,
      "slopeStddevDeg": 5.0775265562679355
    },
    "dataQuality": {
      "validPixelFraction": 1.0,
      "validSlopePixelFraction": 1.0
    }
  },
  "comparison": {
    "rank": 1,
    "distance": 4.4972240634540315,
    "featureDifferences": {
      "meanSlopeZ": 1.3614885335692246,
      "robustReliefZ": 4.286183996268652,
      "slopeVariabilityZ": null
    }
  },
  "configuration": {
    "referenceRegion": "Atacama",
    "selectedFeatures": [
      "mean_slope_deg",
      "robust_relief_m"
    ]
  }
}
```

## Frontend usage

### Map

Use:
- `target.location.latitude`
- `target.location.longitude`
- `candidate.location.latitude`
- `candidate.location.longitude`

Display both locations as separate map markers.

### Terrain comparison

Use the original terrain values from `target.terrain` and `candidate.terrain`.

Recommended chart:
- Mean slope
- Robust relief
- Slope variability

Keep units visible.

Do not compare absolute elevation as though the two planetary vertical reference systems were equivalent.

### Ranking explanation

Use:
- `comparison.rank`
- `comparison.distance`
- `comparison.featureDifferences`

A lower distance indicates a closer match within the selected feature space.

The distance is not a percentage or probability.

### Data quality

Display valid coverage fractions as percentages.

For example, a value of 1.0 represents 100% coverage.

## Backend transformation

The backend should map DuckDB column names into the JSON field names defined above.

| DuckDB column | JSON field |
|---|---|
| target_cell_id | target.cellId |
| target_planet | target.planet |
| target_region | target.region |
| target_latitude | target.location.latitude |
| target_longitude | target.location.longitude |
| earth_cell_id | candidate.cellId |
| earth_region | candidate.region |
| earth_latitude | candidate.location.latitude |
| earth_longitude | candidate.location.longitude |
| distance | comparison.distance |
| rank | comparison.rank |
| slope_difference_z | comparison.featureDifferences.meanSlopeZ |
| relief_difference_z | comparison.featureDifferences.robustReliefZ |
| variability_difference_z | comparison.featureDifferences.slopeVariabilityZ |

The remaining terrain and coverage columns should be mapped to their corresponding target and candidate objects.

## Important implementation rules

1. Preserve NULL values for unselected feature differences.
2. Return numeric fields as JSON numbers, not formatted strings.
3. Preserve the original measurement units.
4. Do not label distance as a percentage.
5. Return coordinates in decimal degrees.
6. Do not imply that elevation values are directly comparable across planetary bodies.
7. Include the discovery configuration so the result can be interpreted in context.

## Current limitations

- Earth reference coverage is currently limited to Atacama.
- Candidate details are recalculated through the discovery macro.
- The current query returns one candidate per target cell and rank.
- Persistent discovery IDs and stored result retrieval are not yet implemented.
