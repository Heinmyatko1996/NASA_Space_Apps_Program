-- TerraTwin API: Earth analog candidate diversity.
--
-- Measures how widely rank-1 matches are distributed across
-- the selected Earth reference region.
--
-- One row is returned for each requested target region.

CREATE OR REPLACE MACRO get_candidate_diversity(
    p_target_planet,
    p_target_region,
    p_reference_region
) AS TABLE

WITH best_matches AS (
    SELECT
        target_cell_id,
        earth_cell_id,
        earth_region
    FROM read_parquet(
        'data/processed/parquet/terrain_analog_rankings_5km_500m.parquet'
    )
    WHERE
        target_planet = p_target_planet
        AND target_region = p_target_region
        AND earth_region = p_reference_region
        AND rank = 1
),

candidate_usage AS (
    SELECT
        earth_cell_id,
        earth_region,
        COUNT(*)::BIGINT AS target_cell_reuse_count
    FROM best_matches
    GROUP BY
        earth_cell_id,
        earth_region
),

usage_ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            ORDER BY
                target_cell_reuse_count DESC,
                earth_cell_id
        ) AS usage_rank
    FROM candidate_usage
),

summary AS (
    SELECT
        COUNT(*)::BIGINT AS target_cell_count,
        COUNT(DISTINCT earth_cell_id)::BIGINT
            AS unique_candidate_count
    FROM best_matches
),

reuse_summary AS (
    SELECT
        MAX(target_cell_reuse_count)::BIGINT
            AS max_candidate_reuse_count
    FROM candidate_usage
)

SELECT
    p_target_planet AS target_planet,
    p_target_region AS target_region,
    p_reference_region AS reference_region,

    s.target_cell_count,
    s.unique_candidate_count,

    ROUND(
        100.0 * s.unique_candidate_count
        / NULLIF(s.target_cell_count, 0),
        2
    ) AS candidate_diversity_pct,

    rs.max_candidate_reuse_count,

    u.earth_cell_id AS most_reused_candidate_cell_id,
    u.earth_region AS most_reused_candidate_region,
    u.target_cell_reuse_count AS most_reused_candidate_count,

    ROUND(
        100.0 * u.target_cell_reuse_count
        / NULLIF(s.target_cell_count, 0),
        2
    ) AS most_reused_candidate_share_pct

FROM summary AS s
CROSS JOIN reuse_summary AS rs

LEFT JOIN usage_ranked AS u
    ON u.usage_rank = 1;
