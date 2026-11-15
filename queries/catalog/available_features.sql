-- Terrain features supported by the current baseline ranking.
-- default_selected identifies the features used in the existing ranking.
--
-- Selecting a different combination in the frontend will require
-- recomputing the ranking with the selected feature dimensions.

SELECT *
FROM (
    VALUES
        (
            'mean_slope_deg',
            'Mean slope',
            'degrees',
            'Average terrain steepness within a grid cell.',
            TRUE,
            1
        ),
        (
            'robust_relief_m',
            'Robust relief',
            'metres',
            'Elevation P90 minus P10 within a grid cell.',
            TRUE,
            2
        ),
        (
            'slope_stddev_deg',
            'Slope variability',
            'degrees',
            'Standard deviation of slope within a grid cell.',
            TRUE,
            3
        )
) AS features (
    feature_id,
    feature_name,
    unit,
    description,
    default_selected,
    sort_order
)
ORDER BY sort_order;
