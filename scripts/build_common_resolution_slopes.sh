#!/usr/bin/env bash

set -euo pipefail

INPUT_DIR="data/processed/common_resolution"

PLANETS=(
    "earth_atacama"
    "moon_south"
    "mars_jezero"
)

for planet in "${PLANETS[@]}"; do

    INPUT="${INPUT_DIR}/${planet}_dem_500m.tif"
    OUTPUT="${INPUT_DIR}/${planet}_slope_500m.tif"

    echo
    echo "=========================================="
    echo "Calculating slope: ${planet}"
    echo "=========================================="

    if [[ ! -f "$INPUT" ]]; then
        echo "ERROR: Missing input: $INPUT"
        exit 1
    fi

    gdaldem slope \
        "$INPUT" \
        "$OUTPUT" \
        -alg Horn \
        -s 1.0 \
        -of GTiff \
        -co COMPRESS=DEFLATE \
        -co PREDICTOR=3 \
        -co TILED=YES \
        -co BLOCKXSIZE=256 \
        -co BLOCKYSIZE=256

    echo "Created: $OUTPUT"

done

echo
echo "=========================================="
echo "ALL COMMON-RESOLUTION SLOPES COMPLETED"
echo "=========================================="
