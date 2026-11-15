-- Planetary Analog Finder: app-owned macros on top of Hein's TerraTwin SQL.
--
-- Registered at boot right after the macros in queries/ (see
-- database/macro_scripts.ts), so run_discovery already exists. Hein's files
-- are used unchanged; everything the website needs beyond them lives here.
--
-- Why a cache table: run_discovery compares every target cell with every
-- Earth cell, which takes about 300 ms for ~370 x ~370 cells. A
-- configuration (target, reference region, feature set) is therefore ranked
-- once, up to rank 25, and stored in discovery_cache. Every macro below
-- reads that table, so clicking around one result takes milliseconds.
-- DiscoveryService fills the cache with:
--
--   INSERT INTO discovery_cache BY NAME
--   SELECT discovery_config_key(world, region, reference, features) AS config_key, *
--   FROM run_discovery(world, region, reference, features, 25);
--
-- Feature order does not change a distance (it is a sum over features), so
-- the key sorts the feature IDs: ['b', 'a'] and ['a', 'b'] share one entry.
--
-- To try the macros in the DuckDB CLI, from the repo root: .read the files
-- in database/macro_scripts.ts in order, run the INSERT above with literal
-- values, then call a macro with the same values.

CREATE TABLE IF NOT EXISTS discovery_cache (
    config_key VARCHAR NOT NULL,
    target_cell_id VARCHAR NOT NULL,
    target_planet VARCHAR NOT NULL,
    target_region VARCHAR NOT NULL,
    earth_cell_id VARCHAR NOT NULL,
    earth_region VARCHAR NOT NULL,
    distance DOUBLE NOT NULL,
    slope_difference_z DOUBLE,
    relief_difference_z DOUBLE,
    variability_difference_z DOUBLE,
    rank BIGINT NOT NULL
);

CREATE OR REPLACE MACRO discovery_config_key(
    p_target_planet,
    p_target_region,
    p_reference_region,
    p_feature_ids
) AS
    p_target_planet || '|' || p_target_region || '|' || p_reference_region || '|'
    || array_to_string(list_sort(p_feature_ids), ',');

-- Cached run_discovery rows for one configuration (same columns as
-- run_discovery, ranks 1-25).
CREATE OR REPLACE MACRO cached_discovery(
    p_target_planet,
    p_target_region,
    p_reference_region,
    p_feature_ids
) AS TABLE
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
FROM discovery_cache
WHERE config_key = discovery_config_key(
    p_target_planet,
    p_target_region,
    p_reference_region,
    p_feature_ids
);

-- Same columns as Hein's get_discovery_summary, but for a custom run instead
-- of the precomputed baseline (docs/website_integration.md requires this).
CREATE OR REPLACE MACRO custom_discovery_summary(
    p_target_planet,
    p_target_region,
    p_reference_region,
    p_feature_ids
) AS TABLE
WITH best_matches AS (
    SELECT
        target_cell_id,
        distance
    FROM cached_discovery(
        p_target_planet,
        p_target_region,
        p_reference_region,
        p_feature_ids
    )
    WHERE rank = 1
)
SELECT
    p_target_planet AS target_planet,
    p_target_region AS target_region,
    p_reference_region AS reference_region,

    COUNT(*)::BIGINT AS target_cell_count,

    ROUND(MIN(distance), 4) AS min_best_distance,
    ROUND(QUANTILE_CONT(distance, 0.25), 4) AS q25_best_distance,
    ROUND(MEDIAN(distance), 4) AS median_best_distance,
    ROUND(QUANTILE_CONT(distance, 0.75), 4) AS q75_best_distance,
    ROUND(MAX(distance), 4) AS max_best_distance,
    ROUND(AVG(distance), 4) AS mean_best_distance
FROM best_matches;

-- Same columns as Hein's get_candidate_diversity, for a custom run.
CREATE OR REPLACE MACRO custom_candidate_diversity(
    p_target_planet,
    p_target_region,
    p_reference_region,
    p_feature_ids
) AS TABLE
WITH best_matches AS (
    SELECT
        target_cell_id,
        earth_cell_id,
        earth_region
    FROM cached_discovery(
        p_target_planet,
        p_target_region,
        p_reference_region,
        p_feature_ids
    )
    WHERE rank = 1
),

candidate_usage AS (
    SELECT
        earth_cell_id,
        earth_region,
        COUNT(*)::BIGINT AS target_cell_reuse_count
    FROM best_matches
    GROUP BY
        earth_cell_id,
        earth_region
),

usage_ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            ORDER BY
                target_cell_reuse_count DESC,
                earth_cell_id
        ) AS usage_rank
    FROM candidate_usage
),

summary AS (
    SELECT
        COUNT(*)::BIGINT AS target_cell_count,
        COUNT(DISTINCT earth_cell_id)::BIGINT AS unique_candidate_count
    FROM best_matches
),

reuse_summary AS (
    SELECT
        MAX(target_cell_reuse_count)::BIGINT AS max_candidate_reuse_count
    FROM candidate_usage
)

SELECT
    p_target_planet AS target_planet,
    p_target_region AS target_region,
    p_reference_region AS reference_region,

    s.target_cell_count,
    s.unique_candidate_count,

    ROUND(
        100.0 * s.unique_candidate_count
        / NULLIF(s.target_cell_count, 0),
        2
    ) AS candidate_diversity_pct,

    rs.max_candidate_reuse_count,

    u.earth_cell_id AS most_reused_candidate_cell_id,
    u.earth_region AS most_reused_candidate_region,
    u.target_cell_reuse_count AS most_reused_candidate_count,

    ROUND(
        100.0 * u.target_cell_reuse_count
        / NULLIF(s.target_cell_count, 0),
        2
    ) AS most_reused_candidate_share_pct

FROM summary AS s
CROSS JOIN reuse_summary AS rs
LEFT JOIN usage_ranked AS u
    ON u.usage_rank = 1;

-- Every cell of the target region (eligible or not) with its grid position,
-- coordinates, and best match in a custom run. Ineligible cells (< 95% DEM or
-- slope coverage) have NULL best_* columns.
CREATE OR REPLACE MACRO target_cell_grid(
    p_target_planet,
    p_target_region,
    p_reference_region,
    p_feature_ids
) AS TABLE
WITH cells AS (
    SELECT
        cell_id,
        grid_row,
        grid_col,
        latitude_center,
        longitude_center,
        valid_pixel_fraction,
        valid_slope_pixel_fraction,
        valid_pixel_fraction >= 0.95
            AND valid_slope_pixel_fraction >= 0.95 AS eligible
    FROM read_parquet(
        'data/processed/parquet/planet_terrain_features_5km_500m.parquet'
    )
    WHERE
        planet = p_target_planet
        AND region = p_target_region
),

best_matches AS (
    SELECT
        target_cell_id,
        earth_cell_id,
        distance
    FROM cached_discovery(
        p_target_planet,
        p_target_region,
        p_reference_region,
        p_feature_ids
    )
    WHERE rank = 1
)

SELECT
    c.cell_id,
    c.grid_row::INTEGER AS grid_row,
    c.grid_col::INTEGER AS grid_col,
    c.latitude_center AS latitude,
    c.longitude_center AS longitude,
    c.eligible,
    c.valid_pixel_fraction,
    c.valid_slope_pixel_fraction,
    b.earth_cell_id AS best_earth_cell_id,
    b.distance AS best_distance
FROM cells AS c
LEFT JOIN best_matches AS b
    ON b.target_cell_id = c.cell_id
ORDER BY
    c.grid_row,
    c.grid_col;

-- Ranked Earth candidates for one target cell in a custom run. Same columns
-- as Hein's get_ranked_candidates (baseline), so one partial renders both.
CREATE OR REPLACE MACRO cell_candidates(
    p_target_planet,
    p_target_region,
    p_target_cell_id,
    p_reference_region,
    p_feature_ids,
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

FROM cached_discovery(
    p_target_planet,
    p_target_region,
    p_reference_region,
    p_feature_ids
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
    r.target_cell_id = p_target_cell_id
    AND r.rank <= p_top_n

ORDER BY r.rank;

-- Bounding box of a region's cells, for map insets.
CREATE OR REPLACE MACRO region_extent(
    p_planet,
    p_region
) AS TABLE
SELECT
    MIN(latitude_center) AS min_latitude,
    MAX(latitude_center) AS max_latitude,
    MIN(longitude_center) AS min_longitude,
    MAX(longitude_center) AS max_longitude,
    COUNT(*)::BIGINT AS cell_count
FROM read_parquet(
    'data/processed/parquet/planet_terrain_features_5km_500m.parquet'
)
WHERE
    planet = p_planet
    AND region = p_region;

-- The target cell with the closest best match in Hein's precomputed
-- baseline ranking, featured on the Explore cards.
CREATE OR REPLACE MACRO featured_target_cell(
    p_target_planet,
    p_target_region,
    p_reference_region
) AS TABLE
SELECT
    target_cell_id,
    earth_cell_id,
    distance
FROM read_parquet(
    'data/processed/parquet/terrain_analog_rankings_5km_500m.parquet'
)
WHERE
    target_planet = p_target_planet
    AND target_region = p_target_region
    AND earth_region = p_reference_region
    AND rank = 1
ORDER BY
    distance,
    target_cell_id
LIMIT 1;
