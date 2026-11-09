# Earth Analog Discovery for Moon and Mars Exploration

> **NASA Space Apps Challenge Project**
>
> Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars

## 1. Project Overview

**TerraTwin** is a geospatial data analysis project that aims to identify Earth locations with measurable terrain and environmental similarities to selected regions on the Moon and Mars.

The goal is to build an explainable discovery engine that can:

1. Analyze terrain and environmental characteristics of selected lunar and Martian regions.
2. Explore candidate locations across Earth.
3. Calculate comparable geospatial features.
4. Rank Earth locations according to their similarity to planetary reference regions.
5. Explain why a particular Earth location is considered a potential analog.

The project is intended as a research and demonstration platform. Similarity scores represent measurable characteristics, not proof that Earth environments are equivalent to extraterrestrial environments.

### Initial comparison targets

| Planetary target | Reference region |
|---|---|
| Moon | Lunar south-polar terrain |
| Mars | Jezero crater |

### Initial Earth candidate regions

These are preliminary study regions. The analysis will determine their suitability rather than assuming they are good analogs.

| Location | Country | Research interest |
|---|---|---|
| Atacama Desert | Chile | Extremely arid terrain |
| McMurdo Dry Valleys | Antarctica | Cold, dry, rocky terrain |
| Icelandic Highlands | Iceland | Volcanic terrain |
| Namib Desert | Namibia | Dunes and arid landscapes |

---

## 2. Project Scope

We will develop the project incrementally.

### Phase 1 — Terrain comparison (current phase)

Initial terrain characteristics:

- Elevation
- Slope
- Local relief
- Terrain roughness

### Phase 2 — Environmental comparison

Potential additional characteristics:

- Surface temperature
- Temperature variation
- Aridity
- Geological characteristics
- Surface composition

### Phase 3 — Analog discovery and ranking

- Generate candidate study windows across Earth.
- Compare their characteristics against planetary reference regions.
- Calculate explainable similarity scores.
- Rank potential analog locations.
- Display the results using interactive maps and comparison charts.

### Important scientific considerations

Earth cannot fully reproduce lunar or Martian environmental conditions.

For example:

- Earth has a substantially different gravity environment.
- The Moon has an extremely thin exosphere and no Earth-like atmosphere.
- Mars has a thin atmosphere and different radiation conditions.
- Surface temperature, geological composition, and terrain measurements have different observation conditions across planetary datasets.

The application must distinguish measurable similarities from environmental differences that cannot be replicated on Earth.

---

## 3. Technology Stack

| Area | Technology |
|---|---|
| Programming language | Python 3.11 |
| Python environment and dependency management | uv |
| Raster processing | Rasterio |
| Geospatial analysis | GeoPandas, Shapely, PyProj |
| Scientific computing | NumPy, SciPy, Pandas |
| Multidimensional datasets | xarray, rioxarray |
| Analytical database | DuckDB |
| Columnar storage | Parquet |
| Visualization | Matplotlib |
| Interactive exploration | JupyterLab |
| Future mapping interface | To be determined |

---

## 4. Development Environment Setup

### Prerequisites

- macOS, Linux, or Windows with a compatible Python environment
- Python 3.11
- Git
- uv package manager

Install uv on macOS:

```bash
brew install uv
```

### Clone the repository

```bash
git clone https://github.com/Heinmyatko1996/NASA_Space_Apps_Program.git
cd NASA_Space_Apps_Program
```

If you are starting from a local project instead, navigate to its directory.

### Create the Python environment

```bash
uv init --python 3.11

uv venv --python 3.11

source .venv/bin/activate
```

### Install dependencies

```bash
uv add \
    numpy \
    pandas \
    scipy \
    rasterio \
    geopandas \
    shapely \
    pyproj \
    xarray \
    rioxarray \
    matplotlib \
    seaborn \
    jupyterlab \
    ipykernel \
    duckdb \
    pyarrow
```

The `uv add` command updates `pyproject.toml` and generates or updates `uv.lock`.

### Verify installation

```bash
uv run python -c "
import rasterio
import geopandas
import shapely
import pyproj
import xarray
import duckdb

print('TerraTwin environment OK')
print('Rasterio:', rasterio.__version__)
print('GeoPandas:', geopandas.__version__)
print('PROJ:', pyproj.proj_version_str)
"
```

Expected output includes:

```text
TerraTwin environment OK
```

### Start JupyterLab

```bash
uv run jupyter lab
```

---

## 5. Project Directory Structure

The intended project structure is:

```text
TerraTwin/
│


[Atacama_Desert.tiff](https://earthexplorer.usgs.gov/scene/metadata/full/5e83a3ee1af480c5/SRTM1S24W070V3/)