-- Available regions for TerraTwin discovery.
-- Moon and Mars are target worlds.
-- Earth regions are the analog candidate library.

SELECT
    planet AS world_id,
    region AS region_id,
    REPLACE(region, '_', ' ') AS region_name,

    CASE
        WHEN planet = 'Earth' THEN 'candidate'
        ELSE 'target'
    END AS region_role,

    COUNT(DISTINCT cell_id) AS eligible_cells

FROM read_parquet(
    'data/processed/parquet/planet_similarity_features_5km_500m.parquet'
)

WHERE planet IN ('Earth', 'Moon', 'Mars')

GROUP BY
    planet,
    region

ORDER BY
    CASE planet
        WHEN 'Moon' THEN 1
        WHEN 'Mars' THEN 2
        WHEN 'Earth' THEN 3
        ELSE 4
    END,
    region;
