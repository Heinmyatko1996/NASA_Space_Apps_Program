-- TerraTwin reference-region catalog.
--
-- Returns regions that can supply Earth candidate cells
-- for terrain analog discovery.
--
-- Run from the repository root.

SELECT
    planet || ':' || region AS reference_id,
    planet AS reference_world_id,
    planet AS reference_world_label,
    region AS reference_region_id,
    CASE
        WHEN region = 'Atacama' THEN 'Atacama'
        ELSE region
    END AS reference_region_label,
    COUNT(DISTINCT cell_id)::BIGINT AS eligible_cell_count,
    500::INTEGER AS feature_grid_resolution_m
FROM read_parquet(
    'data/processed/parquet/planet_similarity_features_5km_500m.parquet'
)
WHERE planet = 'Earth'
GROUP BY
    planet,
    region
ORDER BY
    region;