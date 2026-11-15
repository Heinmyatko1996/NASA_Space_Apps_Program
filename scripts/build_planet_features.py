import math
from pathlib import Path

import numpy as np
import rasterio
import pyarrow as pa
import pyarrow.parquet as pq

from pyproj import CRS, Proj, Transformer


PROJECT_ROOT = Path(__file__).resolve().parents[1]

OUTPUT_PATH = (
    PROJECT_ROOT
    / "data/processed/parquet/planet_terrain_features_5km.parquet"
)

CELL_SIZE_M = 5000
CHUNK_ROWS = 128

DATASETS = [
    {
        "planet": "Earth",
        "region": "Atacama",
        "dem": "data/processed/aoi/earth_atacama_dem.tif",
        "slope": "data/processed/aoi/earth_atacama_slope.tif",
        "aeqd": (
            "+proj=aeqd +lat_0=-23.5 +lon_0=-69.5 "
            "+datum=WGS84 +units=m +no_defs"
        ),
    },
    {
        "planet": "Moon",
        "region": "South_Pole",
        "dem": "data/processed/aoi/moon_south_dem.tif",
        "slope": "data/processed/aoi/moon_south_slope.tif",
        "aeqd": (
            "+proj=aeqd +lat_0=-90 +lon_0=0 "
            "+R=1737400 +units=m +no_defs"
        ),
    },
    {
        "planet": "Mars",
        "region": "Jezero",
        "dem": "data/processed/aoi/mars_jezero_dem.tif",
        "slope": "data/processed/aoi/mars_jezero_slope.tif",
        "aeqd": (
            "+proj=aeqd +lat_0=18.4 +lon_0=77.5 "
            "+R=3396000 +units=m +no_defs"
        ),
    },
]


def build_pixel_coordinates(transform, row_start, row_stop, width):
    """
    Generate source raster pixel-centre coordinates.
    """

    rows = np.arange(
        row_start,
        row_stop,
        dtype=np.float64
    ) + 0.5

    cols = np.arange(
        width,
        dtype=np.float64
    ) + 0.5

    x = (
        transform.c
        + cols[None, :] * transform.a
        + rows[:, None] * transform.b
    )

    y = (
        transform.f
        + cols[None, :] * transform.d
        + rows[:, None] * transform.e
    )

    return x, y


def create_empty_stats():
    return {
        "source_pixel_count": 0,
        "valid_pixel_count": 0,
        "source_area_m2": 0.0,
        "valid_area_m2": 0.0,
        "sum_weight": 0.0,
        "sum_elevation": 0.0,
        "sum_elevation_squared": 0.0,
        "sum_slope": 0.0,
        "sum_slope_squared": 0.0,
        "min_elevation": np.inf,
        "max_elevation": -np.inf,
        "min_slope": np.inf,
        "max_slope": -np.inf,
    }


def aggregate_dataset(config):
    planet = config["planet"]
    region = config["region"]

    dem_path = PROJECT_ROOT / config["dem"]
    slope_path = PROJECT_ROOT / config["slope"]

    local_crs = CRS.from_proj4(config["aeqd"])
    local_projection = Transformer.from_crs(
        local_crs,
        CRS.from_epsg(4326)
        if planet == "Earth"
        else CRS.from_proj4(
            "+proj=longlat "
            + (
                "+R=1737400"
                if planet == "Moon"
                else "+R=3396000"
            )
            + " +no_defs"
        ),
        always_xy=True
    )

    cell_stats = {}

    print("\nProcessing {} / {}".format(planet, region))

    with rasterio.open(dem_path) as dem_src, \
         rasterio.open(slope_path) as slope_src:

        if dem_src.shape != slope_src.shape:
            raise ValueError(
                "{}: DEM and slope dimensions do not match".format(planet)
            )

        if dem_src.transform != slope_src.transform:
            raise ValueError(
                "{}: DEM and slope transforms do not match".format(planet)
            )

        native_crs = CRS.from_wkt(dem_src.crs.to_wkt())
        geographic_crs = native_crs.geodetic_crs

        to_geographic = Transformer.from_crs(
            native_crs,
            geographic_crs,
            always_xy=True
        )

        to_local = Transformer.from_crs(
            native_crs,
            local_crs,
            always_xy=True
        )

        native_projection = Proj(native_crs)

        pixel_area_map = abs(
            dem_src.transform.a * dem_src.transform.e
            - dem_src.transform.b * dem_src.transform.d
        )

        height = dem_src.height
        width = dem_src.width

        for row_start in range(0, height, CHUNK_ROWS):

            row_stop = min(
                row_start + CHUNK_ROWS,
                height
            )

            dem = dem_src.read(
                1,
                window=((row_start, row_stop), (0, width)),
                masked=True
            )

            slope = slope_src.read(
                1,
                window=((row_start, row_stop), (0, width)),
                masked=True
            )

            dem_values = dem.data.astype(
                np.float64,
                copy=False
            )

            slope_values = slope.data.astype(
                np.float64,
                copy=False
            )

            valid = (
                ~np.ma.getmaskarray(dem)
                & ~np.ma.getmaskarray(slope)
                & np.isfinite(dem_values)
                & np.isfinite(slope_values)
            )

            # Source pixel centre coordinates.
            x, y = build_pixel_coordinates(
                dem_src.transform,
                row_start,
                row_stop,
                width
            )

            # Convert native coordinates to planetary longitude/latitude.
            lon, lat = to_geographic.transform(x, y)

            # Convert native coordinates to local ground-distance coordinates.
            local_x, local_y = to_local.transform(x, y)

            if not (
                np.all(np.isfinite(local_x))
                and np.all(np.isfinite(local_y))
                and np.all(np.isfinite(lon))
                and np.all(np.isfinite(lat))
            ):
                raise ValueError(
                    "{}: Non-finite coordinate transformation".format(planet)
                )

            # Calculate local projection area distortion.
            factors = native_projection.get_factors(lon, lat)
            areal_scale = np.asarray(
                factors.areal_scale,
                dtype=np.float64
            )

            if (
                not np.all(np.isfinite(areal_scale))
                or np.any(areal_scale <= 0)
            ):
                raise ValueError(
                    "{}: Invalid projection area scale".format(planet)
                )

            # Correct projected pixel area to ground area.
            ground_area = pixel_area_map / areal_scale

            # Grid origin is the local AEQD origin (0, 0).
            grid_col = np.floor(
                local_x / CELL_SIZE_M
            ).astype(np.int64)

            grid_row = np.floor(
                local_y / CELL_SIZE_M
            ).astype(np.int64)

            # Identify cells for every source pixel, including NoData pixels.
            pairs = np.column_stack((
                grid_row.ravel(),
                grid_col.ravel()
            ))

            unique_cells, inverse, source_counts = np.unique(
                pairs,
                axis=0,
                return_inverse=True,
                return_counts=True
            )

            number_of_cells = len(unique_cells)

            source_area_sums = np.bincount(
                inverse,
                weights=ground_area.ravel(),
                minlength=number_of_cells
            )

            # Add the source-pixel counts and areas.
            for i, pair in enumerate(unique_cells):

                key = (int(pair[0]), int(pair[1]))

                if key not in cell_stats:
                    cell_stats[key] = create_empty_stats()

                stats = cell_stats[key]

                stats["source_pixel_count"] += int(
                    source_counts[i]
                )

                stats["source_area_m2"] += float(
                    source_area_sums[i]
                )

            # Aggregate only valid DEM/slope pixel pairs.
            valid_flat = valid.ravel()

            if not np.any(valid_flat):
                continue

            valid_inverse = inverse[valid_flat]

            weights = ground_area.ravel()[valid_flat]
            elevations = dem_values.ravel()[valid_flat]
            slopes = slope_values.ravel()[valid_flat]

            valid_counts = np.bincount(
                valid_inverse,
                minlength=number_of_cells
            )

            weight_sums = np.bincount(
                valid_inverse,
                weights=weights,
                minlength=number_of_cells
            )

            elevation_sums = np.bincount(
                valid_inverse,
                weights=weights * elevations,
                minlength=number_of_cells
            )

            elevation_squared_sums = np.bincount(
                valid_inverse,
                weights=weights * elevations ** 2,
                minlength=number_of_cells
            )

            slope_sums = np.bincount(
                valid_inverse,
                weights=weights * slopes,
                minlength=number_of_cells
            )

            slope_squared_sums = np.bincount(
                valid_inverse,
                weights=weights * slopes ** 2,
                minlength=number_of_cells
            )

            min_elev = np.full(number_of_cells, np.inf)
            max_elev = np.full(number_of_cells, -np.inf)
            min_slope = np.full(number_of_cells, np.inf)
            max_slope = np.full(number_of_cells, -np.inf)

            np.minimum.at(
                min_elev,
                valid_inverse,
                elevations
            )

            np.maximum.at(
                max_elev,
                valid_inverse,
                elevations
            )

            np.minimum.at(
                min_slope,
                valid_inverse,
                slopes
            )

            np.maximum.at(
                max_slope,
                valid_inverse,
                slopes
            )

            for i, pair in enumerate(unique_cells):

                if valid_counts[i] == 0:
                    continue

                key = (int(pair[0]), int(pair[1]))
                stats = cell_stats[key]

                stats["valid_pixel_count"] += int(
                    valid_counts[i]
                )

                stats["valid_area_m2"] += float(
                    weight_sums[i]
                )

                stats["sum_weight"] += float(
                    weight_sums[i]
                )

                stats["sum_elevation"] += float(
                    elevation_sums[i]
                )

                stats["sum_elevation_squared"] += float(
                    elevation_squared_sums[i]
                )

                stats["sum_slope"] += float(
                    slope_sums[i]
                )

                stats["sum_slope_squared"] += float(
                    slope_squared_sums[i]
                )

                stats["min_elevation"] = min(
                    stats["min_elevation"],
                    float(min_elev[i])
                )

                stats["max_elevation"] = max(
                    stats["max_elevation"],
                    float(max_elev[i])
                )

                stats["min_slope"] = min(
                    stats["min_slope"],
                    float(min_slope[i])
                )

                stats["max_slope"] = max(
                    stats["max_slope"],
                    float(max_slope[i])
                )

            print(
                "\rProcessed rows: {}/{}".format(row_stop, height),
                end="",
                flush=True
            )

        print()

        # Construct final feature records.
        records = []

        for (grid_row, grid_col), stats in sorted(
            cell_stats.items()
        ):

            valid_count = stats["valid_pixel_count"]
            source_count = stats["source_pixel_count"]

            if valid_count == 0:
                continue

            total_weight = stats["sum_weight"]

            mean_elevation = (
                stats["sum_elevation"] / total_weight
            )

            mean_slope = (
                stats["sum_slope"] / total_weight
            )

            elevation_variance = (
                stats["sum_elevation_squared"] / total_weight
                - mean_elevation ** 2
            )

            # Protect against tiny floating-point negative values.
            elevation_variance = max(
                0.0,
                elevation_variance
            )

            # Grid-cell centre in local AEQD coordinates.
            local_center_x = (
                grid_col + 0.5
            ) * CELL_SIZE_M

            local_center_y = (
                grid_row + 0.5
            ) * CELL_SIZE_M

            longitude, latitude = local_projection.transform(
                local_center_x,
                local_center_y
            )

            records.append({
                "planet": planet,
                "region": region,

                "cell_id": "{}_{}_r{}_c{}".format(
                    planet.lower(),
                    region.lower(),
                    grid_row,
                    grid_col
                ),

                "grid_col": grid_col,
                "grid_row": grid_row,

                "local_x_center_m": local_center_x,
                "local_y_center_m": local_center_y,

                "longitude_center": longitude,
                "latitude_center": latitude,

                "mean_elevation_m": mean_elevation,
                "min_elevation_m": stats["min_elevation"],
                "max_elevation_m": stats["max_elevation"],
                "elevation_range_m": (
                    stats["max_elevation"]
                    - stats["min_elevation"]
                ),

                "mean_slope_deg": mean_slope,
                "min_slope_deg": stats["min_slope"],
                "max_slope_deg": stats["max_slope"],

                "slope_stddev_deg": math.sqrt(
                    max(
                        0.0,
                        stats["sum_slope_squared"] / total_weight
                        - mean_slope ** 2
                    )
                ),

                "valid_pixel_count": valid_count,
                "source_pixel_count": source_count,

                "valid_pixel_fraction": (
                    valid_count / source_count
                ),

                "valid_area_m2": stats["valid_area_m2"],

                "source_area_m2": stats["source_area_m2"],

                "valid_area_fraction": (
                    stats["valid_area_m2"]
                    / stats["source_area_m2"]
                    if stats["source_area_m2"] > 0
                    else 0.0
                ),

                "mean_source_pixel_area_m2": (
                    stats["valid_area_m2"] / valid_count
                ),

                "cell_size_m": CELL_SIZE_M,
                "source_crs": native_crs.name,
                "local_grid_crs": local_crs.to_string(),
            })

    print(
        "{}: {} valid grid cells".format(
            planet,
            len(records)
        )
    )

    return records


def main():

    all_records = []

    for config in DATASETS:
        records = aggregate_dataset(config)
        all_records.extend(records)

    if not all_records:
        raise RuntimeError("No terrain feature records generated")

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    table = pa.Table.from_pylist(all_records)

    pq.write_table(
        table,
        OUTPUT_PATH,
        compression="zstd",
        compression_level=6
    )

    print("\n=== OUTPUT ===")
    print("File:", OUTPUT_PATH)
    print("Total cells:", len(all_records))

    print("\n=== PLANET SUMMARY ===")

    for planet in ("Earth", "Moon", "Mars"):

        rows = [
            row for row in all_records
            if row["planet"] == planet
        ]

        if not rows:
            continue

        total_pixels = sum(
            row["valid_pixel_count"]
            for row in rows
        )

        total_area = sum(
            row["valid_area_m2"]
            for row in rows
        )

        weighted_elevation = sum(
            row["mean_elevation_m"] * row["valid_area_m2"]
            for row in rows
        ) / total_area

        weighted_slope = sum(
            row["mean_slope_deg"] * row["valid_area_m2"]
            for row in rows
        ) / total_area

        print(
            "{}: {} cells | {:,} valid pixels | "
            "mean elevation {:.3f} m | mean slope {:.3f}°".format(
                planet,
                len(rows),
                total_pixels,
                weighted_elevation,
                weighted_slope
            )
        )


if __name__ == "__main__":
    main()
