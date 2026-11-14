from pathlib import Path
import math

import numpy as np
import rasterio

from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds, reproject, Resampling


ROOT = Path(__file__).resolve().parents[1]

INPUT_DIR = ROOT / "data/processed/aoi"
OUTPUT_DIR = ROOT / "data/processed/common_resolution"

TARGET_RESOLUTION_M = 500.0
OUTPUT_NODATA = -9999.0


PLANETS = {
    "earth": {
        "region": "Atacama",
        "input": "earth_atacama_dem.tif",
        "output": "earth_atacama_dem_500m.tif",
        "crs": (
            "+proj=aeqd "
            "+lat_0=-23.5 "
            "+lon_0=-69.5 "
            "+datum=WGS84 "
            "+units=m "
            "+no_defs "
            "+type=crs"
        ),
    },
    "moon": {
        "region": "South_Pole",
        "input": "moon_south_dem.tif",
        "output": "moon_south_dem_500m.tif",
        "crs": (
            "+proj=aeqd "
            "+lat_0=-90 "
            "+lon_0=0 "
            "+R=1737400 "
            "+units=m "
            "+no_defs "
            "+type=crs"
        ),
    },
    "mars": {
        "region": "Jezero",
        "input": "mars_jezero_dem.tif",
        "output": "mars_jezero_dem_500m.tif",
        "crs": (
            "+proj=aeqd "
            "+lat_0=18.4 "
            "+lon_0=77.5 "
            "+R=3396000 "
            "+units=m "
            "+no_defs "
            "+type=crs"
        ),
    },
}


def aligned_bounds(bounds, resolution):
    """
    Align output bounds to integer multiples of the target resolution.
    """

    xmin, ymin, xmax, ymax = bounds

    xmin = math.floor(xmin / resolution) * resolution
    ymin = math.floor(ymin / resolution) * resolution
    xmax = math.ceil(xmax / resolution) * resolution
    ymax = math.ceil(ymax / resolution) * resolution

    return xmin, ymin, xmax, ymax


def print_statistics(data, nodata):
    valid = np.isfinite(data)

    if nodata is not None:
        if np.isnan(nodata):
            valid &= ~np.isnan(data)
        else:
            valid &= data != nodata

    values = data[valid]

    if values.size == 0:
        print("WARNING: No valid output pixels")
        return

    print("Valid pixels: {:,}".format(values.size))
    print("Minimum elevation: {:.2f} m".format(values.min()))
    print("Maximum elevation: {:.2f} m".format(values.max()))
    print("Mean elevation: {:.2f} m".format(values.mean()))
    print("Median elevation: {:.2f} m".format(
        np.median(values)
    ))


def process_planet(name, config):

    input_path = INPUT_DIR / config["input"]
    output_path = OUTPUT_DIR / config["output"]

    target_crs = CRS.from_proj4(config["crs"])

    print("\n" + "=" * 65)
    print("Processing {} / {}".format(
        name.capitalize(),
        config["region"]
    ))
    print("=" * 65)

    if not input_path.exists():
        raise FileNotFoundError(input_path)

    with rasterio.open(input_path) as src:

        print("\nSource:")
        print("Dimensions: {} x {}".format(
            src.width,
            src.height
        ))
        print("CRS: {}".format(src.crs))
        print("Bounds: {}".format(src.bounds))
        print("NoData: {}".format(src.nodata))

        # Transform the source extent into the local AEQD CRS.
        target_bounds = transform_bounds(
            src.crs,
            target_crs,
            *src.bounds,
            densify_pts=41
        )

        xmin, ymin, xmax, ymax = aligned_bounds(
            target_bounds,
            TARGET_RESOLUTION_M
        )

        width = int(round(
            (xmax - xmin) / TARGET_RESOLUTION_M
        ))

        height = int(round(
            (ymax - ymin) / TARGET_RESOLUTION_M
        ))

        target_transform = from_origin(
            xmin,
            ymax,
            TARGET_RESOLUTION_M,
            TARGET_RESOLUTION_M
        )

        print("\nTarget:")
        print("CRS: {}".format(target_crs))
        print("Resolution: {} m".format(
            TARGET_RESOLUTION_M
        ))
        print("Dimensions: {} x {}".format(
            width,
            height
        ))
        print("Bounds: {}".format(
            (xmin, ymin, xmax, ymax)
        ))

        # Read source elevation.
        source_data = src.read(1).astype(np.float32)

        destination = np.full(
            (height, width),
            OUTPUT_NODATA,
            dtype=np.float32
        )

        # Reproject and average overlapping source pixels.
        reproject(
            source=source_data,
            destination=destination,

            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src.nodata,

            dst_transform=target_transform,
            dst_crs=target_crs,
            dst_nodata=OUTPUT_NODATA,

            resampling=Resampling.average,

            init_dest_nodata=True,
            num_threads=2,
        )

        # Validate output.
        valid = (
            np.isfinite(destination)
            & (destination != OUTPUT_NODATA)
        )

        if not valid.any():
            raise RuntimeError(
                "No valid pixels generated for {}".format(name)
            )

        profile = {
            "driver": "GTiff",
            "height": height,
            "width": width,
            "count": 1,
            "dtype": "float32",
            "crs": target_crs,
            "transform": target_transform,
            "nodata": OUTPUT_NODATA,
            "compress": "deflate",
            "predictor": 3,
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
        }

        with rasterio.open(
            output_path,
            "w",
            **profile
        ) as dst:

            dst.write(destination, 1)

            dst.set_band_description(
                1,
                "Elevation (m)"
            )

            dst.update_tags(
                planet=name,
                region=config["region"],
                target_resolution_m=str(
                    TARGET_RESOLUTION_M
                ),
                resampling="average",
                projection="local_azimuthal_equidistant",
                processing_stage="common_resolution_dem",
            )

        print("\nOutput:")
        print(output_path)

        print("\nStatistics:")
        print_statistics(
            destination,
            OUTPUT_NODATA
        )

        print("\nValid coverage: {:.2f}%".format(
            valid.mean() * 100
        ))


def main():

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    for name, config in PLANETS.items():
        process_planet(name, config)

    print("\n" + "=" * 65)
    print("COMMON-RESOLUTION DEM PREPARATION COMPLETED")
    print("=" * 65)


if __name__ == "__main__":
    main()
