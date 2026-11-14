-- TerraTwin: configurable Earth analog discovery.
--
-- Calculates rankings using the selected terrain features.
--
-- Parameters:
--   p_target_planet
--   p_target_region
--   p_reference_region
--   p_feature_ids
--   p_top_n
--
-- Normalization:
--   Median and 1.4826 * MAD from eligible Earth reference cells.
--
-- Distance:
--   Euclidean distance across selected standardized features.

CREATE OR REPLACE MACRO run_discovery(
    p_target_planet,
    p_target_region,
    p_reference_region,
    p_feature_ids,
    p_top_n
) AS TABLE

WITH requested_features AS (

    SELECT UNNEST(p_feature_ids) AS feature_id

),

approved_features AS (

    SELECT feature_id
    FROM (
        VALUES
            ('mean_slope_deg'),
            ('robust_relief_m'),
            ('slope_stddev_deg')
    ) AS features(feature_id)

),

eligible_cells AS (

    SELECT *
    FROM read_parquet(
        'data/processed/parquet/planet_terrain_features_5km_500m.parquet'
    )
    WHERE
        valid_pixel_fraction >= 0.95
        AND valid_slope_pixel_fraction >= 0.95

),

earth_cells AS (

    SELECT *
    FROM eligible_cells
    WHERE
        planet = 'Earth'
        AND region = p_reference_region

),

target_cells AS (

    SELECT *
    FROM eligible_cells
    WHERE
        planet = p_target_planet
        AND region = p_target_region

),

feature_values AS (

    SELECT
        planet,
        region,
        cell_id,
        'mean_slope_deg' AS feature_id,
        mean_slope_deg AS feature_value
    FROM eligible_cells

    UNION ALL

    SELECT
        planet,
        region,
        cell_id,
        'robust_relief_m',
        robust_relief_m
    FROM eligible_cells

    UNION ALL

    SELECT
        planet,
        region,
        cell_id,
        'slope_stddev_deg',
        slope_stddev_deg
    FROM eligible_cells

),

selected_features AS (

    SELECT
        r.feature_id
    FROM requested_features r
    INNER JOIN approved_features a
        ON r.feature_id = a.feature_id

),

configuration AS (

    SELECT
        CASE
            WHEN len(p_feature_ids) = 0
                THEN error('Select at least one feature')

            WHEN (
                SELECT COUNT(DISTINCT feature_id)
                FROM requested_features
            ) != len(p_feature_ids)
            THEN error('Duplicate feature IDs are not allowed')
            WHEN (
                SELECT COUNT(*)
                FROM selected_features
            ) != len(p_feature_ids)
                THEN error('Unknown feature ID supplied')

            WHEN p_top_n < 1
                THEN error('p_top_n must be greater than zero')

            WHEN NOT p_target_planet IN ('Moon', 'Mars')
                THEN error('Unsupported target planet')

            WHEN (
                SELECT COUNT(*)
                FROM earth_cells
            ) = 0
                THEN error('No eligible Earth reference cells')

            WHEN (
                SELECT COUNT(*)
                FROM target_cells
            ) = 0
                THEN error('No eligible target cells')

            ELSE TRUE
        END AS is_valid

),

selected_earth_features AS (

    SELECT
        f.cell_id,
        f.feature_id,
        f.feature_value
    FROM feature_values f
    INNER JOIN earth_cells e
        ON f.planet = e.planet
        AND f.region = e.region
        AND f.cell_id = e.cell_id
    INNER JOIN selected_features s
        ON f.feature_id = s.feature_id

),

selected_target_features AS (

    SELECT
        f.cell_id,
        f.feature_id,
        f.feature_value
    FROM feature_values f
    INNER JOIN target_cells t
        ON f.planet = t.planet
        AND f.region = t.region
        AND f.cell_id = t.cell_id
    INNER JOIN selected_features s
        ON f.feature_id = s.feature_id

),

earth_medians AS (

    SELECT
        feature_id,
        MEDIAN(feature_value) AS feature_median
    FROM selected_earth_features
    GROUP BY feature_id

),

earth_scales AS (

    SELECT
        e.feature_id,
        m.feature_median,
        MEDIAN(
            ABS(e.feature_value - m.feature_median)
        ) * 1.4826 AS feature_scale
    FROM selected_earth_features e
    INNER JOIN earth_medians m
        ON e.feature_id = m.feature_id
    GROUP BY
        e.feature_id,
        m.feature_median

),

scale_validation AS (

    SELECT
        CASE
            WHEN NOT c.is_valid
                THEN error('Invalid discovery configuration')

            WHEN COUNT(DISTINCT s.feature_id) != (
                SELECT COUNT(DISTINCT feature_id)
                FROM selected_features
            )
                THEN error('Missing Earth reference scale')

            WHEN COUNT(s.feature_id) FILTER (
                WHERE
                    NOT isfinite(s.feature_scale)
                    OR s.feature_scale = 0
            ) > 0
                THEN error('Invalid Earth reference scale')

            ELSE TRUE
        END AS is_valid

    FROM configuration c
    LEFT JOIN earth_scales s
        ON TRUE
    GROUP BY c.is_valid

),
pairwise_differences AS (

    SELECT
        t.cell_id AS target_cell_id,
        p_target_planet AS target_planet,
        p_target_region AS target_region,

        e.cell_id AS earth_cell_id,
        p_reference_region AS earth_region,

        t.feature_id,

        (
            t.feature_value - e.feature_value
        ) / s.feature_scale AS difference_z

    FROM selected_target_features t
    INNER JOIN selected_earth_features e
        ON t.feature_id = e.feature_id
    INNER JOIN earth_scales s
        ON t.feature_id = s.feature_id

),

pairwise_distances AS (

    SELECT
        target_cell_id,
        target_planet,
        target_region,
        earth_cell_id,
        earth_region,

        SQRT(
            SUM(POWER(difference_z, 2))
        ) AS distance,

        MAX(difference_z) FILTER (
            WHERE feature_id = 'mean_slope_deg'
        ) AS slope_difference_z,

        MAX(difference_z) FILTER (
            WHERE feature_id = 'robust_relief_m'
        ) AS relief_difference_z,

        MAX(difference_z) FILTER (
            WHERE feature_id = 'slope_stddev_deg'
        ) AS variability_difference_z

    FROM pairwise_differences

    GROUP BY
        target_cell_id,
        target_planet,
        target_region,
        earth_cell_id,
        earth_region

),

ranked_candidates AS (

    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY
                target_planet,
                target_region,
                target_cell_id
            ORDER BY
                distance,
                earth_cell_id
        ) AS rank

    FROM pairwise_distances

)

SELECT
    r.target_cell_id,
    r.target_planet,
    r.target_region,
    r.earth_cell_id,
    r.earth_region,
    r.distance,
    r.slope_difference_z,
    r.relief_difference_z,
    r.variability_difference_z,
    r.rank

FROM ranked_candidates r
CROSS JOIN configuration c
CROSS JOIN scale_validation v

WHERE
    c.is_valid
    AND v.is_valid
    AND r.rank <= p_top_n;
