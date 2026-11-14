-- TerraTwin API: ranked Earth analog candidates for one target cell.
--
-- Registers a table macro. Execute this file once per DuckDB connection
-- before calling get_ranked_candidates(...).
--
-- Current implementation:
--   - Uses the validated baseline ranking dataset.
--   - Uses the three baseline features:
--       mean_slope_deg
--       robust_relief_m
--       slope_stddev_deg
--   - Uses precomputed Earth analog rankings.
--
-- This macro does NOT recompute rankings for custom feature selections.

CREATE OR REPLACE MACRO get_ranked_candidates(
    p_target_planet,
    p_target_region,
    p_target_cell_id,
    p_reference_region,
    p_top_n
) AS TABLE
SELECT
    r.target_planet,
    r.target_region,
    r.target_cell_id,

    t.longitude_center AS target_longitude,
    t.latitude_center AS target_latitude,

    t.mean_slope_deg AS target_mean_slope_deg,
    t.robust_relief_m AS target_robust_relief_m,
    t.slope_stddev_deg AS target_slope_stddev_deg,

    r.earth_region AS reference_region,
    r.earth_cell_id AS candidate_cell_id,

    e.longitude_center AS candidate_longitude,
    e.latitude_center AS candidate_latitude,

    e.mean_slope_deg AS candidate_mean_slope_deg,
    e.robust_relief_m AS candidate_robust_relief_m,
    e.slope_stddev_deg AS candidate_slope_stddev_deg,

    r.distance,
    r.slope_difference_z,
    r.relief_difference_z,
    r.variability_difference_z,
    r.rank

FROM read_parquet(
    'data/processed/parquet/terrain_analog_rankings_5km_500m.parquet'
) AS r

INNER JOIN read_parquet(
    'data/processed/parquet/planet_terrain_features_5km_500m.parquet'
) AS t
    ON t.planet = r.target_planet
    AND t.region = r.target_region
    AND t.cell_id = r.target_cell_id

INNER JOIN read_parquet(
    'data/processed/parquet/planet_terrain_features_5km_500m.parquet'
) AS e
    ON e.planet = 'Earth'
    AND e.region = r.earth_region
    AND e.cell_id = r.earth_cell_id

WHERE
    r.target_planet = p_target_planet
    AND r.target_region = p_target_region
    AND r.target_cell_id = p_target_cell_id
    AND r.earth_region = p_reference_region
    AND r.rank <= p_top_n

ORDER BY r.rank;
