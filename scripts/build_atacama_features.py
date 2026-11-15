import csv
import math
import os

import numpy as np
import rasterio
from rasterio.windows import Window

DEM_PATH = "data/processed/aoi/earth_atacama_dem.tif"
SLOPE_PATH = "data/processed/aoi/earth_atacama_slope.tif"
OUTPUT_PATH = "data/processed/parquet/atacama_terrain_features.csv"

CELL_SIZE = 1000.0
CHUNK_ROWS = 256

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

with rasterio.open(DEM_PATH) as dem_src, \
     rasterio.open(SLOPE_PATH) as slope_src:

    # Confirm both rasters are spatially aligned.
    if (
        dem_src.width != slope_src.width
        or dem_src.height != slope_src.height
        or dem_src.transform != slope_src.transform
        or dem_src.crs != slope_src.crs
    ):
        raise ValueError("DEM and slope rasters are not aligned")

    transform = dem_src.transform

    if transform.b != 0 or transform.d != 0:
        raise ValueError("Rotated rasters are not supported")

    if transform.a <= 0 or transform.e >= 0:
        raise ValueError("Expected north-up rasters")

    width = dem_src.width
    height = dem_src.height

    left = transform.c
    top = transform.f
    pixel_width = transform.a
    pixel_height = abs(transform.e)

    # Assign each source pixel to a 1 km projected grid cell.
    x_centers = left + (np.arange(width) + 0.5) * pixel_width

    col_bins = np.floor(
        (x_centers - left) / CELL_SIZE
    ).astype(np.int32)

    row_centers = top - (np.arange(height) + 0.5) * pixel_height

    row_bins = np.floor(
        (top - row_centers) / CELL_SIZE
    ).astype(np.int32)

    n_cols = int(col_bins.max()) + 1
    n_rows = int(row_bins.max()) + 1
    n_cells = n_rows * n_cols

    # Accumulators.
    count = np.zeros(n_cells, dtype=np.int64)

    elevation_sum = np.zeros(n_cells, dtype=np.float64)
    elevation_min = np.full(n_cells, np.inf)
    elevation_max = np.full(n_cells, -np.inf)

    slope_sum = np.zeros(n_cells, dtype=np.float64)
    slope_sum_sq = np.zeros(n_cells, dtype=np.float64)
    slope_max = np.full(n_cells, -np.inf)

    for row_start in range(0, height, CHUNK_ROWS):
        row_count = min(CHUNK_ROWS, height - row_start)

        window = Window(
            col_off=0,
            row_off=row_start,
            width=width,
            height=row_count
        )

        dem = dem_src.read(1, window=window, masked=True)
        slope = slope_src.read(1, window=window, masked=True)

        dem_values = np.asarray(dem.data, dtype=np.float64)
        slope_values = np.asarray(slope.data, dtype=np.float64)

        valid = (
            ~np.ma.getmaskarray(dem)
            & ~np.ma.getmaskarray(slope)
            & np.isfinite(dem_values)
            & np.isfinite(slope_values)
        )

        local_rows = row_bins[row_start:row_start + row_count]

        cell_ids = (
            local_rows[:, None] * n_cols
            + col_bins[None, :]
        )

        ids = cell_ids[valid].ravel()

        if ids.size == 0:
            continue

        elevations = dem_values[valid].ravel()
        slopes = slope_values[valid].ravel()

        count += np.bincount(ids, minlength=n_cells)

        elevation_sum += np.bincount(
            ids, weights=elevations, minlength=n_cells
        )

        slope_sum += np.bincount(
            ids, weights=slopes, minlength=n_cells
        )

        slope_sum_sq += np.bincount(
            ids, weights=slopes * slopes, minlength=n_cells
        )

        np.minimum.at(elevation_min, ids, elevations)
        np.maximum.at(elevation_max, ids, elevations)
        np.maximum.at(slope_max, ids, slopes)

    valid_cells = np.flatnonzero(count > 0)

    with open(OUTPUT_PATH, "w", newline="") as output:
        writer = csv.writer(output)

        writer.writerow([
            "planet",
            "region",
            "cell_id",
            "grid_col",
            "grid_row",
            "x_center",
            "y_center",
            "mean_elevation",
            "min_elevation",
            "max_elevation",
            "elevation_range",
            "mean_slope",
            "max_slope",
            "slope_stddev",
            "valid_pixel_count",
            "source_resolution_m",
            "crs"
        ])

        for cell_id in valid_cells:
            grid_row = int(cell_id // n_cols)
            grid_col = int(cell_id % n_cols)

            mean_elevation = elevation_sum[cell_id] / count[cell_id]
            mean_slope = slope_sum[cell_id] / count[cell_id]

            slope_variance = (
                slope_sum_sq[cell_id] / count[cell_id]
                - mean_slope * mean_slope
            )

            slope_stddev = math.sqrt(max(0.0, slope_variance))

            min_elev = elevation_min[cell_id]
            max_elev = elevation_max[cell_id]

            x_center = left + (grid_col + 0.5) * CELL_SIZE
            y_center = top - (grid_row + 0.5) * CELL_SIZE

            writer.writerow([
                "Earth",
                "Atacama",
                int(cell_id),
                grid_col,
                grid_row,
                round(x_center, 3),
                round(y_center, 3),
                round(mean_elevation, 4),
                round(min_elev, 4),
                round(max_elev, 4),
                round(max_elev - min_elev, 4),
                round(mean_slope, 4),
                round(slope_max[cell_id], 4),
                round(slope_stddev, 4),
                int(count[cell_id]),
                30,
                dem_src.crs.to_string()
            ])

print("Atacama aggregation completed")
print("Grid dimensions: {} x {}".format(n_cols, n_rows))
print("Valid grid cells: {}".format(len(valid_cells)))
print("Output: {}".format(OUTPUT_PATH))
print("Valid source pixels: {}".format(int(count.sum())))
