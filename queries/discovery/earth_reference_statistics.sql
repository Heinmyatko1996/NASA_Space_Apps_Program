-- Shared Earth-reference statistics for baseline terrain features.
-- These statistics define the common scale used for cross-planet comparison.

SELECT
    COUNT(*) AS reference_cells,

    MEDIAN(mean_slope_deg) AS mean_slope_median,
    STDDEV_POP(mean_slope_deg) AS mean_slope_stddev,

    MEDIAN(robust_relief_m) AS robust_relief_median,
    STDDEV_POP(robust_relief_m) AS robust_relief_stddev,

    MEDIAN(slope_stddev_deg) AS slope_stddev_median,
    STDDEV_POP(slope_stddev_deg) AS slope_stddev_stddev

FROM read_parquet(
    'data/processed/parquet/planet_similarity_features_5km_500m.parquet'
)
WHERE planet = 'Earth';
