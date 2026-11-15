-- Planetary Analog Finder: boot-time checks of Hein's TerraTwin data.
--
-- providers/duckdb_provider.ts runs this file first, before the macros in
-- database/macro_scripts.ts, in the same transaction. Each statement returns
-- NULL when the data is fine and calls error() otherwise, which rolls back
-- the transaction and stops the app from starting with the message below.
--
-- DuckDB 2.0 already binds a table macro's body when the macro is created,
-- so a missing file or column would stop boot anyway, but with a bare IO or
-- Binder error. These checks say which file or column is missing and where
-- to get it.
--
-- Pattern: `SELECT CASE WHEN count(*) > 0 THEN error(…) END FROM … WHERE bad`
-- is an aggregate, so it always returns one row and error() fires exactly
-- when a bad row exists. It also lists every bad row in one message.
--
-- Row counts are not hard-coded: Hein will add Earth reference regions.
-- Relative paths resolve against the app root (DuckDB's file_search_path).

-- 1. The three processed Parquet files exist.
SELECT CASE WHEN count(*) > 0 THEN error(
    'Missing TerraTwin data: ' || string_agg(required.name, ', ' ORDER BY required.name)
    || '. Copy the three processed *_5km_500m.parquet files from Hein into '
    || 'the app''s Parquet folder (see plan.md step 2.3).'
) END
FROM (
    VALUES
        ('planet_terrain_features_5km_500m.parquet'),
        ('planet_similarity_features_5km_500m.parquet'),
        ('terrain_analog_rankings_5km_500m.parquet')
) AS required(name)
WHERE required.name NOT IN (
    SELECT parse_filename(file)
    FROM glob('data/processed/parquet/*_5km_500m.parquet')
);

-- 2. Each file has the columns the macros and catalog queries use.
SELECT CASE WHEN count(*) > 0 THEN error(
    'planet_terrain_features_5km_500m.parquet is missing columns: '
    || string_agg(required.name, ', ' ORDER BY required.name)
    || '. Rebuild it with Hein''s pipeline on main (see plan.md step 2.3).'
) END
FROM (
    VALUES
        ('planet'),
        ('region'),
        ('cell_id'),
        ('grid_row'),
        ('grid_col'),
        ('latitude_center'),
        ('longitude_center'),
        ('mean_elevation_m'),
        ('mean_slope_deg'),
        ('robust_relief_m'),
        ('slope_stddev_deg'),
        ('valid_pixel_fraction'),
        ('valid_slope_pixel_fraction')
) AS required(name)
WHERE required.name NOT IN (
    SELECT name
    FROM parquet_schema('data/processed/parquet/planet_terrain_features_5km_500m.parquet')
);

SELECT CASE WHEN count(*) > 0 THEN error(
    'terrain_analog_rankings_5km_500m.parquet is missing columns: '
    || string_agg(required.name, ', ' ORDER BY required.name)
    || '. Rebuild it with Hein''s pipeline on main (see plan.md step 2.3).'
) END
FROM (
    VALUES
        ('target_cell_id'),
        ('target_planet'),
        ('target_region'),
        ('earth_cell_id'),
        ('earth_region'),
        ('distance'),
        ('slope_difference_z'),
        ('relief_difference_z'),
        ('variability_difference_z'),
        ('rank')
) AS required(name)
WHERE required.name NOT IN (
    SELECT name
    FROM parquet_schema('data/processed/parquet/terrain_analog_rankings_5km_500m.parquet')
);

SELECT CASE WHEN count(*) > 0 THEN error(
    'planet_similarity_features_5km_500m.parquet is missing columns: '
    || string_agg(required.name, ', ' ORDER BY required.name)
    || '. Rebuild it with Hein''s pipeline on main (see plan.md step 2.3).'
) END
FROM (
    VALUES
        ('planet'),
        ('region'),
        ('cell_id')
) AS required(name)
WHERE required.name NOT IN (
    SELECT name
    FROM parquet_schema('data/processed/parquet/planet_similarity_features_5km_500m.parquet')
);

-- 3. Earth, the Moon, and Mars each have eligible cells (both coverage
-- fractions >= 0.95, the rule in run_discovery), and the baseline ranking
-- covers both target worlds.
SELECT CASE WHEN count(*) > 0 THEN error(
    'planet_terrain_features_5km_500m.parquet has no eligible cells for: '
    || string_agg(required.planet, ', ' ORDER BY required.planet)
    || ' (eligible = valid_pixel_fraction and valid_slope_pixel_fraction >= 0.95).'
) END
FROM (VALUES ('Earth'), ('Moon'), ('Mars')) AS required(planet)
WHERE required.planet NOT IN (
    SELECT DISTINCT planet
    FROM read_parquet('data/processed/parquet/planet_terrain_features_5km_500m.parquet')
    WHERE
        valid_pixel_fraction >= 0.95
        AND valid_slope_pixel_fraction >= 0.95
);

SELECT CASE WHEN count(*) > 0 THEN error(
    'terrain_analog_rankings_5km_500m.parquet has no baseline rows for: '
    || string_agg(required.planet, ', ' ORDER BY required.planet)
    || '. Rebuild it with Hein''s pipeline on main (see plan.md step 2.3).'
) END
FROM (VALUES ('Moon'), ('Mars')) AS required(planet)
WHERE required.planet NOT IN (
    SELECT DISTINCT target_planet
    FROM read_parquet('data/processed/parquet/terrain_analog_rankings_5km_500m.parquet')
);
