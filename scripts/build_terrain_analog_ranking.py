from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]

INPUT_PATH = (
    ROOT
    / "data/processed/parquet/planet_terrain_features_5km_500m.parquet"
)

OUTPUT_PATH = (
    ROOT
    / "data/processed/parquet/terrain_analog_rankings_5km_500m.parquet"
)

COVERAGE_THRESHOLD = 0.95

FEATURES = {
    "mean_slope_deg": "slope",
    "robust_relief_m": "relief",
    "slope_stddev_deg": "variability",
}


def robust_reference(values):
    median = np.median(values)
    mad = np.median(np.abs(values - median))
    scale = 1.4826 * mad

    if not np.isfinite(scale) or scale == 0:
        raise ValueError("Invalid Earth reference scale")

    return median, scale


def main():

    print("Reading common-resolution terrain features...")

    df = pd.read_parquet(INPUT_PATH)

    eligible = (
        (df["valid_pixel_fraction"] >= COVERAGE_THRESHOLD)
        & (
            df["valid_slope_pixel_fraction"]
            >= COVERAGE_THRESHOLD
        )
    )

    df = df.loc[eligible].copy()

    print("Eligible cells: {}".format(len(df)))

    earth = df[df["planet"] == "Earth"].copy()

    targets = df[df["planet"].isin(["Moon", "Mars"])].copy()

    if earth.empty or targets.empty:
        raise ValueError("Missing Earth or target cells")

    # ---------------------------------------------------------
    # 1. Build shared Earth reference scales
    # ---------------------------------------------------------

    references = {}

    for source_column, feature_name in FEATURES.items():

        values = earth[source_column].to_numpy(
            dtype=np.float64
        )

        median, scale = robust_reference(values)

        references[feature_name] = {
            "median": median,
            "scale": scale,
        }

        print(
            "{}: median={:.4f}, scale={:.4f}".format(
                feature_name,
                median,
                scale
            )
        )

    # ---------------------------------------------------------
    # 2. Standardize all cells using Earth references
    # ---------------------------------------------------------

    for source_column, feature_name in FEATURES.items():

        median = references[feature_name]["median"]
        scale = references[feature_name]["scale"]

        df[feature_name + "_earth_z"] = (
            df[source_column] - median
        ) / scale

    earth = df[df["planet"] == "Earth"].copy()
    targets = df[df["planet"].isin(["Moon", "Mars"])].copy()

    # ---------------------------------------------------------
    # 3. Pairwise target-to-Earth comparison
    # ---------------------------------------------------------

    ranking_records = []

    feature_names = list(FEATURES.values())

    for _, target in targets.iterrows():

        earth_distances = []

        for _, candidate in earth.iterrows():

            differences = {}

            for feature_name in feature_names:

                column = feature_name + "_earth_z"

                differences[feature_name] = (
                    target[column] - candidate[column]
                )

            distance = np.sqrt(
                sum(
                    value ** 2
                    for value in differences.values()
                )
            )

            earth_distances.append({
                "target_cell_id": target["cell_id"],
                "target_planet": target["planet"],
                "target_region": target["region"],

                "earth_cell_id": candidate["cell_id"],
                "earth_region": candidate["region"],

                "distance": distance,

                "slope_difference_z": differences["slope"],
                "relief_difference_z": differences["relief"],
                "variability_difference_z": differences["variability"],
            })

        earth_distances.sort(
            key=lambda record: record["distance"]
        )

        for rank, record in enumerate(
            earth_distances,
            start=1
        ):
            record["rank"] = rank
            ranking_records.append(record)

    # ---------------------------------------------------------
    # 4. Write pairwise rankings
    # ---------------------------------------------------------

    result = pd.DataFrame(ranking_records)

    if result.empty:
        raise ValueError("No analog comparisons generated")

    if not np.isfinite(
        result["distance"].to_numpy()
    ).all():
        raise ValueError("Non-finite distance found")

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    result.to_parquet(
        OUTPUT_PATH,
        index=False,
        compression="zstd"
    )

    print("\n=== OUTPUT ===")
    print("File: {}".format(OUTPUT_PATH))
    print("Comparisons: {}".format(len(result)))

    print("\n=== BEST ANALOG SUMMARY ===")

    best = (
        result[result["rank"] <= 5]
        .groupby("target_planet")
        .agg(
            target_cells=("target_cell_id", "nunique"),
            top_5_comparisons=("rank", "count"),
            median_best_distance=("distance", "median"),
        )
    )

    print(best)


if __name__ == "__main__":
    main()
