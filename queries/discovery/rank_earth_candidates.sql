-- TerraTwin: baseline Earth analog discovery.
--
-- Reproduces build_terrain_analog_ranking.py:
--   1. Apply the 95% coverage threshold.
--   2. Calculate shared Earth median and MAD scales.
--   3. Calculate standardized feature differences.
--   4. Calculate Euclidean distance.
--   5. Rank candidates independently for each target cell.
--
-- Features:
--   mean_slope_deg
--   robust_relief_m
--   slope_stddev_deg

WITH eligible_cells AS (

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
    WHERE planet = 'Earth'

),

target_cells AS (

    SELECT *
    FROM eligible_cells
    WHERE planet IN ('Moon', 'Mars')

),

earth_medians AS (

    SELECT
        MEDIAN(mean_slope_deg) AS slope_median,
        MEDIAN(robust_relief_m) AS relief_median,
        MEDIAN(slope_stddev_deg) AS variability_median
    FROM earth_cells

),

earth_scales AS (

    SELECT
        MEDIAN(ABS(e.mean_slope_deg - m.slope_median))
            * 1.4826 AS slope_scale,

        MEDIAN(ABS(e.robust_relief_m - m.relief_median))
            * 1.4826 AS relief_scale,

        MEDIAN(ABS(e.slope_stddev_deg - m.variability_median))
            * 1.4826 AS variability_scale

    FROM earth_cells e
    CROSS JOIN earth_medians m

),

feature_differences AS (

    SELECT
        t.cell_id AS target_cell_id,
        t.planet AS target_planet,
        t.region AS target_region,

        e.cell_id AS earth_cell_id,
        e.region AS earth_region,

        (t.mean_slope_deg - e.mean_slope_deg)
            / s.slope_scale AS slope_difference_z,

        (t.robust_relief_m - e.robust_relief_m)
            / s.relief_scale AS relief_difference_z,

        (t.slope_stddev_deg - e.slope_stddev_deg)
            / s.variability_scale AS variability_difference_z

    FROM target_cells t
    CROSS JOIN earth_cells e
    CROSS JOIN earth_scales s

),

distances AS (

    SELECT
        *,
        SQRT(
            POW(slope_difference_z, 2)
            + POW(relief_difference_z, 2)
            + POW(variability_difference_z, 2)
        ) AS distance

    FROM feature_differences

),

ranked_candidates AS (

    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY target_planet, target_region, target_cell_id
            ORDER BY distance, earth_cell_id
        ) AS rank

    FROM distances

)

SELECT
    target_cell_id,
    target_planet,
    target_region,
    earth_cell_id,
    earth_region,
    distance,
    slope_difference_z,
    relief_difference_z,
    variability_difference_z,
    rank

FROM ranked_candidates
