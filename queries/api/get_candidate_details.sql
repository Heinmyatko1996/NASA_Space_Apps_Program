CREATE OR REPLACE MACRO get_candidate_details(
    p_target_planet,
    p_target_region,
    p_target_cell_id,
    p_reference_region,
    p_feature_ids,
    p_rank
) AS TABLE

WITH discovery_result AS (
    SELECT *
    FROM run_discovery(
        p_target_planet,
        p_target_region,
        p_reference_region,
        p_feature_ids,
        p_rank
    )
    WHERE target_cell_id = p_target_cell_id
      AND rank = p_rank
),

terrain_features AS (
    SELECT
        planet,
        region,
        cell_id,
        latitude_center,
        longitude_center,
        mean_elevation_m,
        robust_relief_m,
        mean_slope_deg,
        slope_stddev_deg,
        valid_pixel_fraction,
        valid_slope_pixel_fraction
    FROM read_parquet(
        'data/processed/parquet/planet_terrain_features_5km_500m.parquet'
    )
)

SELECT
    d.target_cell_id,
    d.target_planet,
    d.target_region,

    d.earth_cell_id,
    d.earth_region,

    d.rank,
    d.distance,

    -- Target location
    t.latitude_center AS target_latitude,
    t.longitude_center AS target_longitude,

    -- Earth candidate location
    e.latitude_center AS earth_latitude,
    e.longitude_center AS earth_longitude,

    -- Target terrain characteristics
    t.mean_elevation_m AS target_mean_elevation_m,
    t.mean_slope_deg AS target_mean_slope_deg,
    t.robust_relief_m AS target_robust_relief_m,
    t.slope_stddev_deg AS target_slope_stddev_deg,

    -- Earth terrain characteristics
    e.mean_elevation_m AS earth_mean_elevation_m,
    e.mean_slope_deg AS earth_mean_slope_deg,
    e.robust_relief_m AS earth_robust_relief_m,
    e.slope_stddev_deg AS earth_slope_stddev_deg,

    -- Standardized differences
    d.slope_difference_z,
    d.relief_difference_z,
    d.variability_difference_z,

    -- Data quality
    t.valid_pixel_fraction AS target_valid_pixel_fraction,
    e.valid_pixel_fraction AS earth_valid_pixel_fraction,
    t.valid_slope_pixel_fraction AS target_valid_slope_pixel_fraction,
    e.valid_slope_pixel_fraction AS earth_valid_slope_pixel_fraction

FROM discovery_result d

INNER JOIN terrain_features t
    ON t.planet = d.target_planet
   AND t.region = d.target_region
   AND t.cell_id = d.target_cell_id

INNER JOIN terrain_features e
    ON e.planet = 'Earth'
   AND e.region = d.earth_region
   AND e.cell_id = d.earth_cell_id;
