from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parents[1]

INPUT_PATH = (
    ROOT
    / "data/processed/parquet/planet_terrain_features_5km_500m.parquet"
)

OUTPUT_PATH = (
    ROOT
    / "data/processed/parquet/planet_similarity_features_5km_500m.parquet"
)

MIN_CELL_AREA_FRACTION = 0.50


FEATURES = {
    "mean_elevation_m": "relative_elevation",
    "mean_slope_deg": "mean_slope",
    "slope_stddev_deg": "slope_variability",
    "elevation_range_m": "elevation_range",
    "robust_relief_m": "robust_relief",
}


def robust_scale(values):
    """
    Calculate a robust scale using MAD.

    Falls back to IQR, then standard deviation
    if MAD is zero or unavailable.
    """

    median = np.median(values)

    mad = np.median(np.abs(values - median))
    scale = 1.4826 * mad

    if not np.isfinite(scale) or scale == 0:
        q25, q75 = np.percentile(values, [25, 75])
        scale = (q75 - q25) / 1.349

    if not np.isfinite(scale) or scale == 0:
        scale = np.std(values)

    if not np.isfinite(scale) or scale == 0:
        scale = 1.0

    return median, scale


def empirical_percentile(reference_values, values):
    """
    Calculate empirical percentiles against a reference distribution.

    Uses mid-ranks for tied values.
    """

    sorted_values = np.sort(reference_values)

    left = np.searchsorted(
        sorted_values,
        values,
        side="left"
    )

    right = np.searchsorted(
        sorted_values,
        values,
        side="right"
    )

    return (left + right) / (2.0 * len(sorted_values))


def main():

    print("Reading validated terrain features...")

    table = pq.read_table(INPUT_PATH)
    df = table.to_pandas()

    required_columns = [
        "planet",
        "region",
        "cell_id",
        "cell_size_m",
        "mean_elevation_m",
        "mean_slope_deg",
        "slope_stddev_deg",
        "elevation_range_m",
        "valid_area_m2",
        "valid_pixel_count",
        "mean_source_pixel_area_m2",
        "valid_pixel_fraction",
        "valid_slope_pixel_fraction",
    ]

    missing = [
        column for column in required_columns
        if column not in df.columns
    ]

    if missing:
        raise ValueError(
            "Missing required columns: {}".format(missing)
        )
    # Use the same coverage threshold as our distribution analysis.
    eligible = (
        (df["valid_pixel_fraction"] >= 0.95)
        & (df["valid_slope_pixel_fraction"] >= 0.95)
    )

    excluded_cells = int((~eligible).sum())
    df = df.loc[eligible].copy()

    print(
        "Eligible cells: {}".format(len(df))
    )

    print(
        "Excluded cells due to coverage: {}".format(
            excluded_cells
        )
    )

    # Basic feature validity checks.
    for column in FEATURES:
        if not np.isfinite(df[column]).all():
            raise ValueError(
                "Non-finite values found in {}".format(column)
            )

    if (df["valid_area_m2"] <= 0).any():
        raise ValueError("Invalid ground area found")

    if (df["mean_source_pixel_area_m2"] <= 0).any():
        raise ValueError("Invalid source pixel area found")

    # ---------------------------------------------------------
    # 1. Sampling and resolution metadata
    # ---------------------------------------------------------

    df["effective_source_resolution_m"] = np.sqrt(
        df["mean_source_pixel_area_m2"]
    )

    df["resolution_to_cell_ratio"] = (
        df["effective_source_resolution_m"]
        / df["cell_size_m"]
    )

    nominal_cell_area = df["cell_size_m"] ** 2

    df["cell_area_ratio"] = (
        df["valid_area_m2"] / nominal_cell_area
    )

    # This is an approximate indicator, not exact geometric coverage.
    df["cell_area_coverage_estimate"] = (
        df["cell_area_ratio"].clip(upper=1.0)
    )

    df["normalization_reference_cell"] = (
        df["cell_area_ratio"] >= MIN_CELL_AREA_FRACTION
    )

    # ---------------------------------------------------------
    # 2. Region-wise robust normalization
    # ---------------------------------------------------------

    for (planet, region), group in df.groupby(
        ["planet", "region"],
        sort=False
    ):

        group_indices = group.index

        reference = group[
            group["normalization_reference_cell"]
        ]

        if len(reference) < 10:
            raise ValueError(
                "{} / {} has fewer than 10 reference cells".format(
                    planet,
                    region
                )
            )

        print(
            "\n{} / {}".format(planet, region)
        )

        print(
            "Total cells: {}".format(len(group))
        )

        print(
            "Reference cells: {}".format(len(reference))
        )

        for source_column, feature_name in FEATURES.items():

            values = group[source_column].to_numpy(
                dtype=np.float64
            )

            reference_values = reference[
                source_column
            ].to_numpy(dtype=np.float64)

            median, scale = robust_scale(reference_values)

            # Robust standardized value.
            z_values = (values - median) / scale

            # Empirical percentile within the reference distribution.
            percentiles = empirical_percentile(
                reference_values,
                values
            )

            if feature_name == "relative_elevation":
                df.loc[
                    group_indices,
                    "relative_elevation_m"
                ] = values - median

            df.loc[
                group_indices,
                feature_name + "_robust_z"
            ] = z_values

            df.loc[
                group_indices,
                feature_name + "_percentile"
            ] = percentiles

            print(
                "{}: median={:.4f}, robust_scale={:.4f}".format(
                    feature_name,
                    median,
                    scale
                )
            )

        # A dimensionless local-relief measure.
        df.loc[
            group_indices,
            "elevation_range_ratio"
        ] = (
            group["elevation_range_m"].to_numpy()
            / group["cell_size_m"].to_numpy()
        )

        print(
            "Normalization completed for {} / {}".format(
                planet,
                region
            )
        )

    # ---------------------------------------------------------
    # 3. Final validation
    # ---------------------------------------------------------

    generated_columns = [
        "relative_elevation_m",
        "relative_elevation_robust_z",
        "relative_elevation_percentile",
        "mean_slope_robust_z",
        "mean_slope_percentile",
        "slope_variability_robust_z",
        "slope_variability_percentile",
        "elevation_range_robust_z",
        "elevation_range_percentile",
        "elevation_range_ratio",
        "robust_relief_robust_z",
        "robust_relief_percentile",
        "effective_source_resolution_m",
        "resolution_to_cell_ratio",
        "cell_area_ratio",
        "cell_area_coverage_estimate",
        "normalization_reference_cell",
    ]

    for column in generated_columns:

        if not np.isfinite(
            df[column].to_numpy(dtype=np.float64)
        ).all():
            raise ValueError(
                "Non-finite generated feature: {}".format(column)
            )

    percentile_columns = [
        column for column in generated_columns
        if column.endswith("_percentile")
    ]

    for column in percentile_columns:

        if (
            (df[column] < 0).any()
            or (df[column] > 1).any()
        ):
            raise ValueError(
                "Percentile outside [0, 1]: {}".format(column)
            )

    if len(df) == 0:
        raise ValueError("No eligible cells remained")

    # ---------------------------------------------------------
    # 4. Write output
    # ---------------------------------------------------------

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    output_table = pa.Table.from_pandas(
        df,
        preserve_index=False
    )

    pq.write_table(
        output_table,
        OUTPUT_PATH,
        compression="zstd",
        compression_level=6
    )

    print("\n=== OUTPUT ===")
    print("File:", OUTPUT_PATH)
    print("Rows:", len(df))
    print("Original columns:", len(table.column_names))
    print("Generated columns:", len(generated_columns))
    print("Total columns:", len(df.columns))

    print("\n=== FEATURE SUMMARY ===")

    for planet, group in df.groupby("planet"):

        print("\n{}".format(planet))

        for column in (
            "relative_elevation_robust_z",
            "mean_slope_robust_z",
            "slope_variability_robust_z",
            "elevation_range_robust_z",
            "robust_relief_robust_z",
        ):

            print(
                "{}: min={:.3f}, median={:.3f}, max={:.3f}".format(
                    column,
                    group[column].min(),
                    group[column].median(),
                    group[column].max()
                )
            )


if __name__ == "__main__":
    main()
