Absolutely. I've narrowed the six data families down to specific products, rather than leaving you with just the NASA portals.

For TerraTwin, I recommend a three-dataset terrain MVP first, followed by three additional environmental datasets. This keeps the downloads manageable and gives us a complete comparison pipeline.
TerraTwin — Dataset acquisition checklist
Recommended acquisition order
P0
Terrain comparison

Earth SRTM · Moon LOLA · Mars MOLA

P1
Environmental characterization

Earth MODIS · Moon Diviner · Mars THEMIS

1. Earth — SRTM elevation










Product: SRTMGL1.003
Already have a tile
NASA / USGS · 1 arc-second global elevation


Property	Details
Product identifier	SRTMGL1.003
Resolution	Approximately 30 m
Measurement	Elevation
Coverage	60°N to 56°S
Original product format	HGT; other representations available
Data source	NASA / USGS

What to acquire

You already downloaded:
SRTM1S24W070V3


Keep your existing file:
data/raw/earth/Atacama_Desert.tif


Don't download it again.

For additional Earth candidate regions, acquire only the 1-arc-second tiles covering those locations.

Download links:
- NASA SRTMGL1.003 product information
- Search SRTM through NASA Earthdata
NASA describes this as a global 1-arc-second (~30 m) product, with coverage between 60°N and 56°S. 

NASA Open Data Portal

Important: this coverage excludes McMurdo and much of Antarctica, and SRTM does not cover northern Iceland. Those places need different elevation products.
2. Earth — MODIS surface temperature










Product: MOD11A1 Version 6.1
P1 — Environmental
NASA Terra MODIS


Property	Details
Product	MOD11A1.061
Resolution	1 km
Measurement	Daytime and nighttime land-surface temperature
Format	HDF-EOS
Temporal resolution	Daily
Temperature unit	Kelvin, with scale factor 0.02

What to download

For your selected Earth study areas, collect:
Data layer	Purpose
LST_Day_1km	Daytime surface temperature
LST_Night_1km	Nighttime surface temperature
QC_Day	Daytime quality information
QC_Night	Nighttime quality information
Clear_day_cov	Daytime observation coverage
Clear_night_cov	Nighttime observation coverage

The temperature conversion is:
\[
T(K)=DN \times 0.02
\]

To convert Kelvin to Celsius:
\[
T(°C)=T(K)-273.15
\]

We must apply quality filtering before calculating temperature statistics. 

NASA+1

Download links:
- MOD11A1 product information
- MODIS LST user guide
- Find MOD11A1 granules in Earthdata
My recommendation: begin with one representative seasonal period for each Earth candidate area. Don't download years of daily imagery immediately.

3. Moon — LOLA elevation










Product: LDEM_80S_80MPP_ADJ.TIF
P0 — Terrain
Lunar Reconnaissance Orbiter / LOLA


This is the product I recommend downloading for our initial lunar south-polar comparison.
Property	Details
Filename	LDEM_80S_80MPP_ADJ.TIF
Resolution	80 m/pixel
Coverage	80°S to 90°S
Measurement	Elevation in metres
Format	Cloud-Optimized GeoTIFF
Projection	South polar stereographic
Reference frame	MOON_ME, JPL DE421
Approximate file size	181 MB

Download these files:
Essential
Download

LDEM_80S_80MPP_ADJ.TIF

Recommended quality layers

LDEM_80S_80MPP_ADJ_ERR.TIF

Elevation measurement error.

LDEM_80S_80MPP_ADJ_EFFRES.TIF

Effective spatial resolution.

LDEC_80S_80MPP_ADJ.TIF

Number of LOLA observations per pixel.

The main DEM is approximately 181 MB; its corresponding uncertainty, effective-resolution and counts products provide useful quality information. 

PGDA+1

Download links:
- NASA Goddard — A New View of the Lunar South Pole from LOLA
- Download the 80 m south-polar DEM
Don't download the 5 m-per-pixel site-specific DEMs yet. They are much larger and unnecessary for our initial regional comparison.

4. Moon — Diviner thermal and resource characteristics










Product: DLRE Polar Resource Product V2.0
P1 — Environmental and resources
Lunar Reconnaissance Orbiter / Diviner


This one is especially interesting for a future lunar base analog.
Property	Details
Dataset ID	LRO-L-DLRE-5-PRP-V2.0
South product	DLRE_PRP_SOUTH.TAB
Format	ASCII fixed-length table
Mesh	2,880,000 triangular elements
Coverage	South polar region to 80° latitude

The product contains:
- Annual average surface temperature.
- Annual maximum surface temperature.
- Estimated depth to water-ice permafrost.
These are model-derived quantities from Diviner observations, not simply raw temperature images. 

ode.rsl.wustl.edu+1

Download these files:
DLRE_PRP_SOUTH.TAB
DLRE_PRP_SOUTH.LBL
DLRE_PRP.FMT


Also retain the corresponding product XML label and collection metadata.

The main table is about 605 MB. Its label describes the 210-byte records and 15 columns, so we can use the PDS format definition when loading it into DuckDB.

Important
 Download V2.0, not V1.0. NASA's archive explicitly warns that V1.0 was erroneous. 
pds.nasa.gov

Download links:
- Diviner Polar Resource Product documentation
- South-polar product directory
- NASA PDS V2.0 dataset information
This is not a GeoTIFF. We'll treat it as a mesh-based spatial dataset, rather than trying to load it through the raster extension.

5. Mars — MOLA elevation










Product: MOLA MEGDR 128 pixels/degree
P0 — Terrain
Mars Global Surveyor / MOLA


For the Jezero Crater reference region, we can select its regional MOLA tile.

Jezero is approximately around 18.4°N, 77.5°E. This falls within the MOLA 128-pixels-per-degree tile covering 0–44°N and 0–90°E. 

Public Release+1

Recommended product
megt44n000hb.img
Property	Details
Product	MOLA topography MEGDR
Resolution	128 pixels/degree
Approximate north–south spacing	463 m
Measurement	Elevation relative to Mars areoid
Format	PDS image (.img)
Area	44°N to 0°, 0°E to 90°E


Download the associated files as well:
megt44n000hb.img
megt44n000hb.xml
megt44n000hb.lbl
megt44n000hb.hdr


Optionally acquire:
megc44n000hb.img


This is the MOLA observation-count layer, useful for inspecting data support.

The MOLA archive provides a maintained PDS4 bundle with the image files and their metadata. The T in megt identifies the topography product; don't accidentally choose the planetary-radius or counts products as your DEM. 

pds-geosciences.wustl.edu+1

Download links:
- MOLA MEGDR product directory
- Download Jezero-region MOLA topography
- MOLA archive and product explanation

6. Mars — THEMIS thermal characteristics










Product: THEMIS quantitative thermal inertia mosaic
P1 — Environmental and surface
Mars Odyssey / THEMIS


For TerraTwin, I would choose quantitative thermal inertia, not merely a colored or normalized browse image.
Property	Details
Product	THEMIS Global Thermal Inertia Mosaic — Quantitative
Native resolution	100 m/pixel
Data type	32-bit
Measurement	Thermal inertia
Format	ISIS3 / GeoTIFF alternatives
Coverage	Regional global mosaics

Thermal inertia is useful for characterizing surface materials. It indicates how strongly the surface resists changes in temperature, and can help distinguish fine dust and sand from coarser or rockier materials. 

astrogeology.usgs.gov

Download link:

- USGS Astropedia — THEMIS global thermal inertia mosaic

In the catalogue, select the quantitative 32-bit tile covering Jezero. It should be the tile for approximately 0–30°N and 60–120°E (00N060E); verify the tile's actual geographic extent in its metadata before downloading.

The 100 m global mosaic tiles can be large: the catalogue lists approximately 2.5 GB for one quantitative tile. This is an optional download for the first demo, not a prerequisite.

8. Final download manifest
Here is the concise acquisition list to work from.
#	Planet	Product / filename	Status
1	Earth	Atacama SRTM GeoTIFF	Have it
2	Earth	MOD11A1.061	Acquire
3	Moon	LDEM_80S_80MPP_ADJ.TIF	Acquire
4	Moon	DLRE_PRP_SOUTH.TAB	Acquire
5	Mars	megt44n000hb.img	Acquire
6	Mars	THEMIS quantitative thermal inertia	Optional

9. Recommended project directories
Keep raw files separated by planet and instrument.
data/
│
├── raw/
│   ├── earth/
│   │   ├── elevation/
│   │   │   └── Atacama_Desert.tif
│   │   └── temperature/
│   │       └── MOD11A1/
│   │
│   ├── moon/
│   │   ├── elevation/
│   │   │   ├── LDEM_80S_80MPP_ADJ.TIF
│   │   │   ├── LDEM_80S_80MPP_ADJ_ERR.TIF
│   │   │   └── LDEM_80S_80MPP_ADJ_EFFRES.TIF
│   │   └── temperature/
│   │       └── DLRE_PRP_SOUTH.TAB
│   │
│   └── mars/
│       ├── elevation/
│       │   └── MOLA/
│       └── thermal/
│           └── THEMIS/
│
├── processed/
│   ├── harmonized/
│   ├── terrain_features/
│   └── environmental_features/
│
└── results/
    └── parquet/


10. Two scientific points before we start processing
First: don't treat all three thermal products as the same measurement.

MODIS measures Earth land-surface temperature; Diviner PRP contains lunar model-derived surface temperatures and ice-depth estimates; THEMIS quantitative thermal inertia measures a different thermophysical property.

We can use them to characterize and explain their respective environments, but shouldn't put their raw values into one temperature similarity score.

Second: don't force every product to 500 m.
- Elevation: harmonize the DEMs after inspecting their native resolution.
- Slope and local relief: calculate at consistent physical scales.
- MODIS: retain its 1 km support.
- Diviner: preserve its triangular mesh and documented measurements.
- THEMIS: preserve its native thermal-inertia raster until the analysis scale is decided.

What I would download first
Given the hackathon time constraints, my order would be:
First acquisition batch
- [x] Atacama SRTM
- [ ] LOLA 80 m DEM
- [ ] MOLA Jezero topography tile

Second acquisition batch
- [ ] MODIS MOD11A1
- [ ] Diviner South Polar Resource Product

Optional enhancement
- [ ] THEMIS quantitative thermal inertia

The first three are enough to prove that TerraTwin can compare topography across Earth, Moon and Mars. We can add the environmental layers once that pipeline works.

A useful next step is to record each downloaded file's actual dimensions, CRS, pixel size, units, NoData value and source citation in a single dataset_inventory.csv before loading it into DuckDB.