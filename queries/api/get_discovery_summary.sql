-- TerraTwin API: summary statistics for one target region.
--
-- Summarizes the best Earth candidate (rank = 1) for each
-- eligible target cell in the selected region.
--
-- This reports the current precomputed baseline ranking only.

CREATE OR REPLACE MACRO get_discovery_summary(
    p_target_planet,
    p_target_region,
    p_reference_region
) AS TABLE

WITH best_matches AS (
    SELECT
        target_cell_id,
        distance
    FROM read_parquet(
        'data/processed/parquet/terrain_analog_rankings_5km_500m.parquet'
    )
    WHERE
        target_planet = p_target_planet
        AND target_region = p_target_region
        AND earth_region = p_reference_region
        AND rank = 1
)

SELECT
    p_target_planet AS target_planet,
    p_target_region AS target_region,
    p_reference_region AS reference_region,

    COUNT(*)::BIGINT AS target_cell_count,

    ROUND(MIN(distance), 4) AS min_best_distance,
    ROUND(QUANTILE_CONT(distance, 0.25), 4) AS q25_best_distance,
    ROUND(MEDIAN(distance), 4) AS median_best_distance,
    ROUND(QUANTILE_CONT(distance, 0.75), 4) AS q75_best_distance,
    ROUND(MAX(distance), 4) AS max_best_distance,
    ROUND(AVG(distance), 4) AS mean_best_distance

FROM best_matches;
