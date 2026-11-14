from pathlib import Path

import numpy as np
import rasterio
import pyarrow.parquet as pq

from pyproj import CRS, Proj, Transformer


ROOT = Path(__file__).resolve().parents[1]

PARQUET_PATH = (
    ROOT / "data/processed/parquet/planet_terrain_features_5km.parquet"
)

DATASETS = {
    "Earth": (
        "data/processed/aoi/earth_atacama_dem.tif",
        "data/processed/aoi/earth_atacama_slope.tif",
    ),
    "Moon": (
        "data/processed/aoi/moon_south_dem.tif",
        "data/processed/aoi/moon_south_slope.tif",
    ),
    "Mars": (
        "data/processed/aoi/mars_jezero_dem.tif",
        "data/processed/aoi/mars_jezero_slope.tif",
    ),
}

CHUNK_ROWS = 128


def calculate_direct_stats(dem_path, slope_path):

    total_weight = 0.0
    elevation_sum = 0.0
    slope_sum = 0.0

    min_elevation = np.inf
    max_elevation = -np.inf
    min_slope = np.inf
    max_slope = -np.inf

    valid_count = 0

    with rasterio.open(dem_path) as dem_src, \
         rasterio.open(slope_path) as slope_src:

        native_crs = CRS.from_wkt(dem_src.crs.to_wkt())
        geographic_crs = native_crs.geodetic_crs

        transformer = Transformer.from_crs(
            native_crs,
            geographic_crs,
            always_xy=True
        )

        projection = Proj(native_crs)

        pixel_area_map = abs(
            dem_src.transform.a * dem_src.transform.e
            - dem_src.transform.b * dem_src.transform.d
        )

        for row_start in range(0, dem_src.height, CHUNK_ROWS):

            row_stop = min(
                row_start + CHUNK_ROWS,
                dem_src.height
            )

            window = (
                (row_start, row_stop),
                (0, dem_src.width)
            )

            dem = dem_src.read(1, window=window, masked=True)
            slope = slope_src.read(1, window=window, masked=True)

            valid = (
                ~np.ma.getmaskarray(dem)
                & ~np.ma.getmaskarray(slope)
                & np.isfinite(dem.data)
                & np.isfinite(slope.data)
            )

            if not np.any(valid):
                continue

            rows = np.arange(row_start, row_stop) + 0.5
            cols = np.arange(dem_src.width) + 0.5

            x = (
                dem_src.transform.c
                + cols[None, :] * dem_src.transform.a
                + rows[:, None] * dem_src.transform.b
            )

            y = (
                dem_src.transform.f
                + cols[None, :] * dem_src.transform.d
                + rows[:, None] * dem_src.transform.e
            )

            lon, lat = transformer.transform(x, y)

            factors = projection.get_factors(lon, lat)
            ground_area = pixel_area_map / factors.areal_scale

            weights = ground_area[valid]
            elevations = dem.data[valid].astype(np.float64)
            slopes = slope.data[valid].astype(np.float64)

            total_weight += weights.sum()
            elevation_sum += np.dot(weights, elevations)
            slope_sum += np.dot(weights, slopes)

            valid_count += len(elevations)

            min_elevation = min(min_elevation, elevations.min())
            max_elevation = max(max_elevation, elevations.max())
            min_slope = min(min_slope, slopes.min())
            max_slope = max(max_slope, slopes.max())

    return {
        "valid_pixels": valid_count,
        "mean_elevation": elevation_sum / total_weight,
        "mean_slope": slope_sum / total_weight,
        "min_elevation": min_elevation,
        "max_elevation": max_elevation,
        "min_slope": min_slope,
        "max_slope": max_slope,
        "total_ground_area": total_weight,
    }


def main():

    table = pq.read_table(PARQUET_PATH).to_pydict()

    print("\n=== DIRECT RASTER vs PARQUET ===")

    for planet, (dem, slope) in DATASETS.items():

        direct = calculate_direct_stats(
            ROOT / dem,
            ROOT / slope
        )

        indices = [
            i for i, value in enumerate(table["planet"])
            if value == planet
        ]

        valid_area = np.array([
            table["valid_area_m2"][i]
            for i in indices
        ])

        parquet_elevation = np.array([
            table["mean_elevation_m"][i]
            for i in indices
        ])

        parquet_slope = np.array([
            table["mean_slope_deg"][i]
            for i in indices
        ])

        parquet = {
            "valid_pixels": sum(
                table["valid_pixel_count"][i]
                for i in indices
            ),
            "mean_elevation": np.average(
                parquet_elevation,
                weights=valid_area
            ),
            "mean_slope": np.average(
                parquet_slope,
                weights=valid_area
            ),
        }

        print("\n{}".format(planet))

        for metric in (
            "valid_pixels",
            "mean_elevation",
            "mean_slope",
        ):
            difference = (
                direct[metric] - parquet[metric]
            )

            print(
                "{}: direct={:.8f} | parquet={:.8f} | "
                "difference={:.10f}".format(
                    metric,
                    direct[metric],
                    parquet[metric],
                    difference
                )
            )

        print(
            "Direct ground area: {:.2f} m²".format(
                direct["total_ground_area"]
            )
        )

        print(
            "Parquet ground area: {:.2f} m²".format(
                valid_area.sum()
            )
        )


if __name__ == "__main__":
    main()
