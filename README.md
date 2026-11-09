# TerraTwin — Earth Analog Discovery for Moon and Mars

> **NASA Space Apps Challenge Project**
>
> Challenge: Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars

## 1. Project Overview

**TerraTwin** is a geospatial discovery platform that aims to identify Earth locations with measurable terrain and environmental similarities to selected regions on the Moon and Mars.

The project aims to build an explainable discovery engine that can:

1. Analyze terrain and environmental characteristics of lunar and Martian reference regions.
2. Explore candidate locations across Earth.
3. Calculate comparable geospatial features.
4. Rank Earth locations according to their similarity to planetary reference regions.
5. Explain why a particular Earth location is considered a potential analog.

Similarity scores represent measurable characteristics, not proof that Earth environments are equivalent to extraterrestrial environments.

### Initial comparison targets

| Planetary target | Reference region |
|---|---|
| Moon | Lunar south-polar terrain |
| Mars | Jezero crater |

### Initial Earth candidate regions

These are preliminary study regions. Their suitability will be evaluated through data analysis.

| Location | Country | Research interest |
|---|---|---|
| Atacama Desert | Chile | Extremely arid terrain |
| McMurdo Dry Valleys | Antarctica | Cold, dry, rocky terrain |
| Icelandic Highlands | Iceland | Volcanic terrain |
| Namib Desert | Namibia | Dunes and arid landscapes |

---

## 2. Project Roadmap

### Phase 1 — Terrain comparison

Initial characteristics:

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
- Display results using interactive maps and comparison charts.

### Scientific considerations

Earth cannot fully reproduce lunar or Martian environmental conditions.

For example:

- Earth has a substantially different gravity environment.
- The Moon has an extremely thin exosphere and no Earth-like atmosphere.
- Mars has a thin atmosphere and different radiation conditions.
- Temperature, geology, and terrain measurements may have different observation conditions across planetary datasets.

TerraTwin will distinguish measurable similarities from environmental differences that cannot be replicated on Earth.

---

## 3. Technology Stack

| Area | Technology |
|---|---|
| Programming language | Python 3.11 |
| Environment and dependency management | uv |
| Raster processing | Rasterio |
| Geospatial analysis | GeoPandas, Shapely, PyProj |
| Scientific computing | NumPy, SciPy, Pandas |
| Multidimensional datasets | xarray, rioxarray |
| Analytical database | DuckDB |
| Columnar storage | Parquet |
| Visualization | Matplotlib |
| Interactive exploration | JupyterLab |

---

## 4. Getting Started

### Prerequisites

- Python 3.11
- Git
- uv package manager

### Install uv

For macOS:

```bash
brew install uv
```

For other operating systems, see the [official uv installation guide](https://docs.astral.sh/uv/getting-started/installation/).

### Clone the repository

```bash
git clone https://github.com/Heinmyatko1996/NASA_Space_Apps_Program.git

cd NASA_Space_Apps_Program
```

### Install project dependencies

```bash
uv sync
```

This creates the local `.venv` environment and installs dependencies based on `pyproject.toml` and `uv.lock`.

### Verify the environment

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

### Start JupyterLab

```bash
uv run jupyter lab
```

---

## 5. Project Structure

```text
NASA_Space_Apps_Program/
│
├── data/
│   ├── raw/
│   │   ├── earth/
│   │   ├── moon/
│   │   └── mars/
│   │
│   └── processed/
│
├── docs/
│   └── dataset_inventory.csv
│
├── notebooks/
│   └── 01_dem_exploration.ipynb
│
├── results/
│
├── src/
│   └── terratwin/
│       ├── __init__.py
│       ├── ingestion/
│       ├── processing/
│       │   └── terrain_metrics.py
│       └── scoring/
│           └── similarity.py
│
├── pyproject.toml
├── uv.lock
├── .gitignore
└── README.md
```

---

## 6. Dataset Exploration — Atacama Desert, Chile

### 6.1 Dataset selection

The first Earth elevation dataset selected for exploration is:

**SRTM 1 Arc-Second Global**

Source: [USGS EarthExplorer](https://earthexplorer.usgs.gov/)

| Property | Value |
|---|---|
| Dataset | SRTM 1 Arc-Second Global |
| Approximate resolution | 30 metres |
| Coordinate system | EPSG:4326 |
| Selected format | GeoTIFF |
| File extension | `.tif` |
| Intended use | Earth elevation and terrain analysis |

### 6.2 Downloaded dataset

The selected Atacama tile is:

**SRTM1S24W070V3**

[View dataset metadata and download options on USGS EarthExplorer](https://earthexplorer.usgs.gov/scene/metadata/full/5e83a3ee1af480c5/SRTM1S24W070V3/)

Download format: **GeoTIFF 1 Arc-Second**

Save the downloaded file as:

```text
data/raw/earth/Atacama_Desert.tif
```

The raw raster dataset is excluded from Git because of its size. Each contributor should download the dataset independently.

### 6.3 Dataset inspection

The GeoTIFF was inspected using Rasterio.

```python
import rasterio

dem_path = "data/raw/earth/Atacama_Desert.tif"

with rasterio.open(dem_path) as src:
    print("CRS:", src.crs)
    print("Resolution:", src.res)
    print("Width:", src.width)
    print("Height:", src.height)
    print("Bounds:", src.bounds)
    print("NoData:", src.nodata)
    print("Data type:", src.dtypes)
```

Observed metadata:

| Property | Observed value |
|---|---|
| CRS | EPSG:4326 |
| Resolution | 0.0002777777777777778 degrees |
| Width | 3,601 pixels |
| Height | 3,601 pixels |
| Left | -70.0001388889 |
| Bottom | -24.0001388889 |
| Right | -68.9998611111 |
| Top | -22.9998611111 |
| NoData | -32767 |
| Data type | int16 |

This is a one-degree SRTM tile with edge samples included.

At approximately 23.5° south latitude:

- North–south pixel spacing is approximately 30.9 metres.
- East–west pixel spacing is approximately 28.3 metres.

### 6.4 Initial elevation visualization

The downloaded DEM was visualized using Rasterio and Matplotlib.

Initial observations:

- Lower-elevation terrain appears in the western portion.
- Intermediate elevations occur across the central portion.
- Higher mountainous terrain appears in the eastern portion.
- The tile contains significant elevation variation.

The tile should not be treated as one homogeneous analog location. Future analysis will divide it into smaller candidate study windows.

---

## 7. Next Development Milestone — Terrain Metrics

The next step is to reproject the geographic DEM into a suitable projected coordinate system before calculating terrain metrics.

### Proposed processing configuration

| Property | Value |
|---|---|
| Source CRS | EPSG:4326 |
| Target CRS | EPSG:32719 |
| Target CRS description | WGS 84 / UTM Zone 19S |
| Target resolution | Approximately 30 metres |
| Output | `data/processed/atacama_utm.tif` |

### Planned terrain metrics

| Metric | Description | Unit |
|---|---|---|
| Slope | Terrain steepness | Degrees |
| Local relief | Local maximum elevation minus minimum elevation | Metres |
| Terrain Ruggedness Index (TRI) | Elevation variation among neighboring cells | Metres, depending on definition |

Reprojection and resampling do not create new elevation information or improve the original dataset's accuracy.

---

## 8. Planetary Reference Datasets — Planned

| Planet | Dataset | Intended use |
|---|---|---|
| Earth | SRTM / Copernicus DEM | Terrain elevation |
| Moon | LOLA DEM | Lunar terrain elevation |
| Mars | MOLA MEGDR | Martian terrain elevation |
| Earth | MODIS Land Surface Temperature | Surface temperature |
| Mars | THEMIS | Thermal properties and temperature |
| Moon | Diviner | Lunar thermal observations |

Useful data portals:

- [NASA Earthdata](https://earthdata.nasa.gov/)
- [NASA Planetary Data System](https://pds.nasa.gov/)
- [USGS Astrogeology](https://astrogeology.usgs.gov/)
- [USGS EarthExplorer](https://earthexplorer.usgs.gov/)

Dataset resolution, coordinate systems, vertical references, coverage, and measurement definitions must be checked before comparing products.

---

## 9. Dataset Inventory

Dataset discovery and selection should be documented in:

```text
docs/dataset_inventory.csv
```

Suggested fields:

```text
dataset_name,
planet,
feature,
source,
instrument,
spatial_resolution,
units,
crs,
coverage,
processing_level,
documentation_url,
limitations,
status
```

This inventory will track selected, pending, and rejected datasets.

---

## 10. Current Project Status

| Task | Status |
|---|---|
| Define TerraTwin project direction | Completed |
| Identify initial planetary reference regions | Proposed |
| Identify initial Earth candidate regions | Proposed |
| Set up Python environment using uv | Initial setup |
| Select Atacama SRTM dataset | Completed |
| Download Atacama GeoTIFF | Completed |
| Inspect GeoTIFF metadata | Completed |
| Visualize elevation | Completed |
| Calculate elevation statistics | Pending |
| Reproject DEM to UTM | Next |
| Calculate terrain metrics | Pending |
| Download Moon reference DEM | Pending |
| Download Mars reference DEM | Pending |
| Implement similarity scoring | Pending |
| Build interactive visualization | Pending |

---

## 11. Contribution Guidelines

Contributors can help explore the project independently by:

1. Setting up the environment using `uv sync`.
2. Reading the documentation for potential datasets.
3. Downloading and inspecting additional Earth or planetary datasets.
4. Exploring candidate Earth regions.
5. Investigating terrain or environmental metrics.
6. Documenting dataset limitations and comparability.

When investigating a new dataset, consider:

- What scientific feature does it measure?
- Which planet does it cover?
- What is its spatial resolution?
- What are its units and coordinate system?
- Is it suitable for comparison with another planetary dataset?
- What are its limitations?

Please document findings in the dataset inventory and share reproducible notebooks or processing code.

---

## Project Principle

**TerraTwin aims to discover and explain potential planetary analogs using measurable geospatial evidence.**

The objective is not simply to find visually similar landscapes, but to identify where measurable characteristics match, quantify those similarities, and communicate the limitations of each comparison.