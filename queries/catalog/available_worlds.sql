-- Available target worlds for TerraTwin discovery.
-- Earth is intentionally excluded: it is the candidate analog library.

SELECT
    planet AS world_id,
    planet AS world_name,
    COUNT(DISTINCT region) AS available_regions,
    COUNT(DISTINCT cell_id) AS eligible_cells
FROM read_parquet(
    'data/processed/parquet/planet_similarity_features_5km_500m.parquet'
)
WHERE planet IN ('Moon', 'Mars')
GROUP BY planet
ORDER BY
    CASE planet
        WHEN 'Moon' THEN 1
        WHEN 'Mars' THEN 2
        ELSE 3
    END;
