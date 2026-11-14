#!/usr/bin/env python3

import math
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

from pyproj import CRS, Proj, Transformer


PROJECT_ROOT = Path(__file__).resolve().parents[1]

INPUT_DIR = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "common_resolution"
)

OUTPUT_PATH = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "parquet"
    / "planet_terrain_features_5km_500m.parquet"
)

CELL_SIZE_M = 5000.0
PIXEL_SIZE_M = 500.0
BLOCK_ROWS = 32


DATASETS = [
    {
        "planet": "Earth",
        "region": "Atacama",
        "name": "earth_atacama",
        "aeqd": (
            "+proj=aeqd +lat_0=-23.5 +lon_0=-69.5 "
            "+datum=WGS84 +units=m +no_defs"
        ),
        "geographic_crs": "EPSG:4326",
        "source_crs": "WGS84 local AEQD",
    },
    {
        "planet": "Moon",
        "region": "South_Pole",
        "name": "moon_south",
        "aeqd": (
            "+proj=aeqd +lat_0=-90 +lon_0=0 "
            "+R=1737400 +units=m +no_defs"
        ),
        "geographic_crs": (
            "+proj=longlat +R=1737400 +no_defs"
        ),
        "source_crs": "Moon local AEQD",
    },
    {
        "planet": "Mars",
        "region": "Jezero",
        "name": "mars_jezero",
        "aeqd": (
            "+proj=aeqd +lat_0=18.4 +lon_0=77.5 "
            "+R=3396000 +units=m +no_defs"
        ),
        "geographic_crs": (
            "+proj=longlat +R=3396000 +no_defs"
        ),
        "source_crs": "Mars local AEQD",
    },
]


def create_empty_stats():
    return {
        "source_pixel_count": 0,
        "source_area_m2": 0.0,

        "valid_pixel_count": 0,
        "valid_area_m2": 0.0,

        "valid_slope_pixel_count": 0,
        "valid_slope_area_m2": 0.0,

        "sum_elevation": 0.0,
        "sum_elevation_squared": 0.0,

        "sum_slope": 0.0,
        "sum_slope_squared": 0.0,

        "min_elevation": np.inf,
        "max_elevation": -np.inf,

        "elevation_values": [],
        "elevation_weights": [],

        "min_slope": np.inf,
        "max_slope": -np.inf,
    }


def accumulate(
    cell_stats,
    unique_cells,
    inverse,
    ground_area,
    values,
    valid_mask,
    feature
):
    """
    Accumulate area-weighted statistics for one feature.

    Elevation and slope are processed independently because
    the Horn slope algorithm produces edge NoData pixels.
    """

    flat_mask = valid_mask.ravel()

    if not np.any(flat_mask):
        return

    cell_indices = inverse[flat_mask]

    weights = ground_area.ravel()[flat_mask]
    observations = values.ravel()[flat_mask]

    number_of_cells = len(unique_cells)

    counts = np.bincount(
        cell_indices,
        minlength=number_of_cells
    )

    weight_sums = np.bincount(
        cell_indices,
        weights=weights,
        minlength=number_of_cells
    )

    weighted_sums = np.bincount(
        cell_indices,
        weights=weights * observations,
        minlength=number_of_cells
    )

    weighted_squared_sums = np.bincount(
        cell_indices,
        weights=weights * observations ** 2,
        minlength=number_of_cells
    )

    minimums = np.full(
        number_of_cells,
        np.inf
    )

    maximums = np.full(
        number_of_cells,
        -np.inf
    )

    np.minimum.at(
        minimums,
        cell_indices,
        observations
    )

    np.maximum.at(
        maximums,
        cell_indices,
        observations
    )

    for i, pair in enumerate(unique_cells):

        if counts[i] == 0:
            continue

        key = (
            int(pair[0]),
            int(pair[1])
        )

        if key not in cell_stats:
            cell_stats[key] = create_empty_stats()

        stats = cell_stats[key]

        if feature == "elevation":

            stats["valid_pixel_count"] += int(counts[i])
            cell_mask = cell_indices == i

            stats["elevation_values"].extend(observations[cell_mask].tolist())

            stats["elevation_weights"].extend(weights[cell_mask].tolist())
            stats["valid_area_m2"] += float(weight_sums[i])

            stats["sum_elevation"] += float(weighted_sums[i])

            stats["sum_elevation_squared"] += float(
                weighted_squared_sums[i]
            )

            stats["min_elevation"] = min(
                stats["min_elevation"],
                float(minimums[i])
            )

            stats["max_elevation"] = max(
                stats["max_elevation"],
                float(maximums[i])
            )

        elif feature == "slope":

            stats["valid_slope_pixel_count"] += int(counts[i])

            stats["valid_slope_area_m2"] += float(
                weight_sums[i]
            )

            stats["sum_slope"] += float(weighted_sums[i])

            stats["sum_slope_squared"] += float(
                weighted_squared_sums[i]
            )

            stats["min_slope"] = min(
                stats["min_slope"],
                float(minimums[i])
            )

            stats["max_slope"] = max(
                stats["max_slope"],
                float(maximums[i])
            )


def aggregate_dataset(config):

    name = config["name"]

    dem_path = (
        INPUT_DIR
        / "{}_dem_500m.tif".format(name)
    )

    slope_path = (
        INPUT_DIR
        / "{}_slope_500m.tif".format(name)
    )

    print(
        "\nProcessing {} / {}".format(
            config["planet"],
            config["region"]
        )
    )

    if not dem_path.exists():
        raise FileNotFoundError(dem_path)

    if not slope_path.exists():
        raise FileNotFoundError(slope_path)

    local_crs = CRS.from_proj4(
        config["aeqd"]
    )

    geographic_crs = CRS.from_user_input(
    config["geographic_crs"]
    )

    local_projection = Proj(local_crs)

    to_geographic = Transformer.from_crs(
        local_crs,
        geographic_crs,
        always_xy=True
    )

    cell_stats = {}

    with rasterio.open(dem_path) as dem_src, \
            rasterio.open(slope_path) as slope_src:

        # Verify raster alignment.
        if dem_src.crs != slope_src.crs:
            raise ValueError(
                "{}: DEM and slope CRS differ".format(name)
            )

        if dem_src.transform != slope_src.transform:
            raise ValueError(
                "{}: DEM and slope transforms differ".format(name)
            )

        if (
            dem_src.width != slope_src.width
            or dem_src.height != slope_src.height
        ):
            raise ValueError(
                "{}: DEM and slope dimensions differ".format(name)
            )

        if (
            not np.isclose(
                abs(dem_src.transform.a),
                PIXEL_SIZE_M
            )
            or not np.isclose(
                abs(dem_src.transform.e),
                PIXEL_SIZE_M
            )
        ):
            raise ValueError(
                "{}: Unexpected pixel size".format(name)
            )

        width = dem_src.width
        height = dem_src.height

        transform = dem_src.transform

        for row_start in range(
            0,
            height,
            BLOCK_ROWS
        ):

            row_stop = min(
                row_start + BLOCK_ROWS,
                height
            )

            window = rasterio.windows.Window(
                0,
                row_start,
                width,
                row_stop - row_start
            )

            # Read only the current DEM block.
            dem = dem_src.read(
                1,
                window=window
            ).astype(np.float64)

            dem_valid = (
                dem_src.read_masks(
                    1,
                    window=window
                ) > 0
            ) & np.isfinite(dem)

            # Read only the current slope block.
            slope = slope_src.read(
                1,
                window=window
            ).astype(np.float64)

            slope_valid = (
                slope_src.read_masks(
                    1,
                    window=window
                ) > 0
            ) & np.isfinite(slope)

            rows = np.arange(
                row_start,
                row_stop
            )

            cols = np.arange(width)

            col_grid, row_grid = np.meshgrid(
                cols,
                rows
            )

            # Pixel centre coordinates.
            x = (
                transform.c
                + (col_grid + 0.5) * transform.a
                + (row_grid + 0.5) * transform.b
            )

            y = (
                transform.f
                + (col_grid + 0.5) * transform.d
                + (row_grid + 0.5) * transform.e
            )

            # Convert local coordinates to planetary coordinates.
            lon, lat = to_geographic.transform(
                x,
                y
            )

            # Calculate local AEQD projection areal scale.
            factors = local_projection.get_factors(
                lon,
                lat
            )

            areal_scale = np.asarray(
                factors.areal_scale,
                dtype=np.float64
            )

            if (
                not np.all(np.isfinite(areal_scale))
                or np.any(areal_scale <= 0)
            ):
                raise ValueError(
                    "{}: Invalid projection areal scale".format(name)
                )

            # Correct projected pixel area to ground area.
            ground_area = (
                PIXEL_SIZE_M ** 2
            ) / areal_scale

            # Preserve original grid origin (0, 0).
            grid_col = np.floor(
                x / CELL_SIZE_M
            ).astype(np.int64)

            grid_row = np.floor(
                y / CELL_SIZE_M
            ).astype(np.int64)

            pairs = np.column_stack((
                grid_row.ravel(),
                grid_col.ravel()
            ))

            unique_cells, inverse = np.unique(
                pairs,
                axis=0,
                return_inverse=True
            )

            number_of_cells = len(unique_cells)

            # Count every DEM pixel, including NoData.
            source_counts = np.bincount(
                inverse,
                minlength=number_of_cells
            )

            source_area_sums = np.bincount(
                inverse,
                weights=ground_area.ravel(),
                minlength=number_of_cells
            )

            for i, pair in enumerate(unique_cells):

                key = (
                    int(pair[0]),
                    int(pair[1])
                )

                if key not in cell_stats:
                    cell_stats[key] = create_empty_stats()

                stats = cell_stats[key]

                stats["source_pixel_count"] += int(
                    source_counts[i]
                )

                stats["source_area_m2"] += float(
                    source_area_sums[i]
                )

            # Accumulate DEM and slope independently.
            accumulate(
                cell_stats,
                unique_cells,
                inverse,
                ground_area,
                dem,
                dem_valid,
                "elevation"
            )

            accumulate(
                cell_stats,
                unique_cells,
                inverse,
                ground_area,
                slope,
                slope_valid,
                "slope"
            )

            print(
                "\rProcessed rows: {}/{}".format(
                    row_stop,
                    height
                ),
                end="",
                flush=True
            )

        print()

    # Construct final feature records.
    records = []

    for (grid_row, grid_col), stats in sorted(
        cell_stats.items()
    ):

        dem_count = stats["valid_pixel_count"]

        slope_count = stats["valid_slope_pixel_count"]

        source_count = stats["source_pixel_count"]

        if dem_count == 0:
            continue
        elevation_values = np.asarray(
            stats["elevation_values"],
            dtype=np.float64
        )

        elevation_weights = np.asarray(
            stats["elevation_weights"],
            dtype=np.float64
        )

        elevation_p10 = np.quantile(
            elevation_values,
            0.10,
            weights=elevation_weights,
            method="inverted_cdf"
        )

        elevation_p90 = np.quantile(
            elevation_values,
            0.90,
            weights=elevation_weights,
            method="inverted_cdf"
        )

        robust_relief = elevation_p90 - elevation_p10

        elevation_weight = stats["valid_area_m2"]

        mean_elevation = (
            stats["sum_elevation"] / elevation_weight
        )

        # Grid-cell centre in local AEQD coordinates.
        local_center_x = (
            grid_col + 0.5
        ) * CELL_SIZE_M

        local_center_y = (
            grid_row + 0.5
        ) * CELL_SIZE_M

        longitude, latitude = to_geographic.transform(
            local_center_x,
            local_center_y
        )

        if slope_count > 0:

            slope_weight = stats["valid_slope_area_m2"]

            mean_slope = (
                stats["sum_slope"] / slope_weight
            )

            slope_variance = (
                stats["sum_slope_squared"] / slope_weight
                - mean_slope ** 2
            )

            slope_stddev = math.sqrt(
                max(0.0, slope_variance)
            )

            min_slope = stats["min_slope"]
            max_slope = stats["max_slope"]

        else:

            mean_slope = np.nan
            slope_stddev = np.nan
            min_slope = np.nan
            max_slope = np.nan

        records.append({

            "planet": config["planet"],
            "region": config["region"],

            "cell_id": "{}_{}_r{}_c{}".format(
                name.lower(),
                config["region"].lower(),
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
            "elevation_p10_m": float(elevation_p10),
            "elevation_p90_m": float(elevation_p90),
            "robust_relief_m": float(robust_relief),

            "elevation_range_m": (
                stats["max_elevation"]
                - stats["min_elevation"]
            ),

            "mean_slope_deg": mean_slope,
            "min_slope_deg": min_slope,
            "max_slope_deg": max_slope,
            "slope_stddev_deg": slope_stddev,

            "valid_pixel_count": dem_count,
            "valid_slope_pixel_count": slope_count,
            "source_pixel_count": source_count,

            "valid_pixel_fraction": (
                dem_count / source_count
            ),

            "valid_slope_pixel_fraction": (
                slope_count / source_count
            ),

            "valid_area_m2": stats["valid_area_m2"],
            "valid_slope_area_m2": stats["valid_slope_area_m2"],
            "source_area_m2": stats["source_area_m2"],

            "valid_area_fraction": (
                stats["valid_area_m2"]
                / stats["source_area_m2"]
            ),

            "valid_slope_area_fraction": (
                stats["valid_slope_area_m2"]
                / stats["source_area_m2"]
            ),

            "mean_source_pixel_area_m2": (
                stats["valid_area_m2"] / dem_count
            ),

            "cell_size_m": CELL_SIZE_M,
            "effective_source_resolution_m": PIXEL_SIZE_M,

            "source_crs": config["source_crs"],
            "local_grid_crs": local_crs.to_string(),
        })

    print(
        "{}: {} valid grid cells".format(
            name,
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
        raise RuntimeError(
            "No terrain feature records generated"
        )

    df = pd.DataFrame(all_records)

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    df.to_parquet(
        OUTPUT_PATH,
        index=False,
        compression="zstd"
    )

    print("\nOutput:", OUTPUT_PATH)

    print("Total cells:", len(df))

    print("\nCells by planet:")

    print(
        df.groupby("planet")
        .size()
        .to_string()
    )

    print("\nFeature summary:")

    print(
        df.groupby("planet")[
            [
                "mean_elevation_m",
                "mean_slope_deg",
                "slope_stddev_deg",
                "valid_pixel_fraction",
                "valid_slope_pixel_fraction",
            ]
        ]
        .agg(["count", "mean", "median"])
        .round(4)
        .to_string()
    )


if __name__ == "__main__":
    main()
