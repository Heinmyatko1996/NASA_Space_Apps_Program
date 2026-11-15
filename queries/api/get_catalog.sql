-- TerraTwin website catalog
--
-- Returns the available target worlds, reference regions,
-- and selectable terrain features in one flat result.
--
-- Run from the project root.
-- The backend can group rows using item_type:
--   world   -> worlds
--   region  -> regions
--   feature -> features

WITH source_features AS (
    SELECT *
    FROM read_parquet(
        'data/processed/parquet/planet_similarity_features_5km_500m.parquet'
    )
),

world_catalog AS (
    SELECT
        planet AS world_id,
        planet AS world_label,
        COUNT(DISTINCT region) AS region_count,
        COUNT(DISTINCT cell_id) AS eligible_cell_count
    FROM source_features
    WHERE planet IN ('Moon', 'Mars')
    GROUP BY planet
),

region_catalog AS (
    SELECT
        planet AS world_id,
        planet || ':' || region AS region_id,
        CASE
            WHEN region = 'South_Pole' THEN 'South Pole'
            WHEN region = 'Jezero' THEN 'Jezero'
            WHEN region = 'Atacama' THEN 'Atacama'
            ELSE region
        END AS region_label,
        CASE
            WHEN planet = 'Earth' THEN 'candidate'
            ELSE 'target'
        END AS region_role,
        COUNT(DISTINCT cell_id) AS eligible_cell_count
    FROM source_features
    GROUP BY
        planet,
        region
),

feature_catalog AS (
    SELECT *
    FROM (
        VALUES
            (
                'mean_slope_deg',
                'Mean slope',
                'degrees',
                'Average terrain slope within a grid cell.',
                TRUE,
                1
            ),
            (
                'robust_relief_m',
                'Robust relief',
                'metres',
                'Elevation difference between the 90th and 10th percentiles.',
                TRUE,
                2
            ),
            (
                'slope_stddev_deg',
                'Slope variability',
                'degrees',
                'Standard deviation of terrain slope within a grid cell.',
                TRUE,
                3
            )
    ) AS features(
        feature_id,
        feature_label,
        unit,
        description,
        default_selected,
        sort_order
    )
),

catalog_rows AS (

    -- Target worlds
    SELECT
        'world'::VARCHAR AS item_type,
        world_id,
        world_label,
        NULL::VARCHAR AS region_id,
        NULL::VARCHAR AS region_label,
        NULL::VARCHAR AS region_role,
        NULL::BIGINT AS eligible_cell_count,
        region_count::BIGINT AS region_count,
        NULL::VARCHAR AS feature_id,
        NULL::VARCHAR AS feature_label,
        NULL::VARCHAR AS unit,
        NULL::VARCHAR AS description,
        NULL::BOOLEAN AS default_selected,
        NULL::INTEGER AS sort_order,
        CASE world_id
            WHEN 'Moon' THEN 1
            WHEN 'Mars' THEN 2
            ELSE 99
        END AS catalog_order
    FROM world_catalog

    UNION ALL

    -- Target and candidate regions
    SELECT
        'region'::VARCHAR AS item_type,
        world_id,
        world_id AS world_label,
        region_id,
        region_label,
        region_role,
        eligible_cell_count::BIGINT,
        NULL::BIGINT AS region_count,
        NULL::VARCHAR AS feature_id,
        NULL::VARCHAR AS feature_label,
        NULL::VARCHAR AS unit,
        NULL::VARCHAR AS description,
        NULL::BOOLEAN AS default_selected,
        NULL::INTEGER AS sort_order,
        CASE
            WHEN world_id = 'Moon' THEN 1
            WHEN world_id = 'Mars' THEN 2
            WHEN world_id = 'Earth' THEN 3
            ELSE 99
        END AS catalog_order
    FROM region_catalog

    UNION ALL

    -- Selectable terrain features
    SELECT
        'feature'::VARCHAR AS item_type,
        NULL::VARCHAR AS world_id,
        NULL::VARCHAR AS world_label,
        NULL::VARCHAR AS region_id,
        NULL::VARCHAR AS region_label,
        NULL::VARCHAR AS region_role,
        NULL::BIGINT AS eligible_cell_count,
        NULL::BIGINT AS region_count,
        feature_id,
        feature_label,
        unit,
        description,
        default_selected,
        sort_order,
        1 AS catalog_order
    FROM feature_catalog
)

SELECT
    item_type,
    world_id,
    world_label,
    region_id,
    region_label,
    region_role,
    eligible_cell_count,
    region_count,
    feature_id,
    feature_label,
    unit,
    description,
    default_selected,
    sort_order
FROM catalog_rows
ORDER BY
    CASE item_type
        WHEN 'world' THEN 1
        WHEN 'region' THEN 2
        WHEN 'feature' THEN 3
        ELSE 99
    END,
    catalog_order,
    sort_order NULLS LAST,
    region_id NULLS LAST,
    feature_id NULLS LAST;