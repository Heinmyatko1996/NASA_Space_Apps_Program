import type { GeoPoint, RegionExtent } from '#services/discovery_service'

/**
 * Server-side map snapshots (plan.md Phase 5): NASA GIBS WMS image URLs plus
 * marker positions computed here, so the page needs no client map library.
 *
 * GIBS serves EPSG:4326 (plate carrée) imagery: x is linear in longitude and
 * y is linear in latitude. A point's position inside a requested bounding box
 * is therefore a linear interpolation, expressed in percent so the markers
 * stay aligned however large the image is drawn.
 *
 * Earth only. The Moon South Pole region lies near −88° latitude, where this
 * projection breaks down, so target regions are drawn as a cell grid instead
 * (partials/grid_cells.edge).
 */

export const GIBS_WMS_ENDPOINT = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'

/** Degrees; south < north and west < east (no antimeridian crossing). */
export interface BoundingBox {
  south: number
  west: number
  north: number
  east: number
}

export interface MapPosition {
  leftPct: number
  topPct: number
}

export interface GibsLayer {
  id: string
  /** Button label in the layer switcher. */
  label: string
  /** GIBS layer identifier, from the WMS GetCapabilities document. */
  name: string
  /**
   * Pinned date for time-varying layers, so the demo image never changes
   * and never shows today's partly acquired swaths. Static layers have none.
   */
  time?: string
  /** Shown under the image: product, date, and how to read it. */
  caption: string
  /** GIBS legend image for layers with a color scale, and its alt text. */
  legend?: { url: string; alt: string }
}

/** Cloud-free full-globe composite for the Earth overview map. */
export const GLOBE_LAYER: GibsLayer = {
  id: 'blueMarble',
  label: 'Blue Marble',
  name: 'BlueMarble_NextGeneration',
  caption: 'NASA Blue Marble: Next Generation, cloud-free composite (GIBS).',
}

/**
 * Context layers for the reference-region inset. The ranking uses terrain
 * features only; these images just help people read the place.
 */
export const INSET_LAYERS: readonly GibsLayer[] = [
  {
    id: 'trueColor',
    label: 'True color',
    name: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    time: '2026-11-01',
    caption: 'VIIRS (NOAA-20) corrected reflectance, true color, 1 Nov 2026.',
  },
  {
    id: 'temperature',
    label: 'Surface temperature',
    name: 'MODIS_Terra_L3_Land_Surface_Temp_8Day_Day',
    time: '2026-10-24',
    caption: 'MODIS Terra daytime land surface temperature, 8-day composite from 24 Oct 2026.',
    legend: {
      url: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_H.png',
      alt: 'Color scale: land surface temperature from below 200 K (violet) through 290 K (yellow) to 350 K and above (red).',
    },
  },
  {
    id: 'elevation',
    label: 'Elevation',
    name: 'ASTER_GDEM_Color_Shaded_Relief',
    caption: 'ASTER GDEM color shaded relief (elevation).',
  },
]

const GLOBE_BOX: BoundingBox = { south: -90, west: -180, north: 90, east: 180 }
const GLOBE_SIZE = { width: 2048, height: 1024 }
const INSET_SIZE = 640
/** Space around a region's cell centers: a 5 km cell is about 0.045°. */
const INSET_MARGIN_DEG = 0.12
/** Half a 5 km cell in degrees of latitude: cell centers ± this = cell edges. */
const HALF_CELL_DEG = 2.5 / 111.32
const GRATICULE_STEP_DEG = 30
/**
 * Marker footprint in percent of the inset frame's side, sized for the
 * smallest frame (~350 px on a phone): a 22 px marker plus its 2 px ring and
 * shadow is about 7%, and grouped markers sit 4 px (~1.2%) apart. Neighboring
 * 5 km cells are only about 4% apart in the Atacama inset, so close
 * candidates are common.
 */
const MARKER_SLOT_PCT = 7
const MARKER_GAP_PCT = 1.2

const round2 = (value: number) => Math.round(value * 100) / 100

export interface MapMarkerInput {
  location: GeoPoint
  label: string
}

export interface RankedMarkerInput {
  rank: number
  cellId: string
  location: GeoPoint
}

export default class MapSnapshotService {
  /**
   * A GIBS WMS 1.3.0 GetMap URL. In WMS 1.3.0, EPSG:4326 uses latitude /
   * longitude axis order, so BBOX is `south,west,north,east`.
   */
  gibsUrl(layer: GibsLayer, box: BoundingBox, width: number, height: number): string {
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      REQUEST: 'GetMap',
      VERSION: '1.3.0',
      LAYERS: layer.name,
      STYLES: '',
      CRS: 'EPSG:4326',
      BBOX: [box.south, box.west, box.north, box.east].map((value) => round6(value)).join(','),
      WIDTH: String(width),
      HEIGHT: String(height),
      FORMAT: 'image/jpeg',
    })
    if (layer.time) {
      params.set('TIME', layer.time)
    }
    return `${GIBS_WMS_ENDPOINT}?${params}`
  }

  /**
   * Position of a point inside `box`, in percent from the left and top
   * edges. Null when the point lies outside the box.
   */
  project(point: GeoPoint, box: BoundingBox): MapPosition | null {
    const x = (point.longitude - box.west) / (box.east - box.west)
    const y = (box.north - point.latitude) / (box.north - box.south)
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
      return null
    }
    return { leftPct: round2(x * 100), topPct: round2(y * 100) }
  }

  /**
   * A box around a region's cell centers, with a margin, widened in one
   * direction so it is square on the ground: a degree of longitude spans
   * cos(latitude) of a degree of latitude. A square image of it then shows
   * the region's true shape.
   */
  insetBox(extent: RegionExtent, marginDeg = INSET_MARGIN_DEG): BoundingBox {
    const midLat = (extent.minLatitude + extent.maxLatitude) / 2
    const midLon = (extent.minLongitude + extent.maxLongitude) / 2
    const lonScale = Math.cos((midLat * Math.PI) / 180)

    const halfLat = (extent.maxLatitude - extent.minLatitude) / 2 + marginDeg
    const halfLon = (extent.maxLongitude - extent.minLongitude) / 2 + marginDeg / lonScale
    // Half-extent of the square side in "latitude degrees" (ground units).
    const half = Math.max(halfLat, halfLon * lonScale)

    return {
      south: Math.max(-90, midLat - half),
      north: Math.min(90, midLat + half),
      west: midLon - half / lonScale,
      east: midLon + half / lonScale,
    }
  }

  /**
   * Full-globe Earth map: Blue Marble image, a 30° graticule, and one marker
   * per input point.
   */
  globe(markers: MapMarkerInput[]) {
    return {
      src: this.gibsUrl(GLOBE_LAYER, GLOBE_BOX, GLOBE_SIZE.width, GLOBE_SIZE.height),
      width: GLOBE_SIZE.width,
      height: GLOBE_SIZE.height,
      caption: GLOBE_LAYER.caption,
      graticule: this.graticule(),
      markers: markers.flatMap((marker) => {
        const position = this.project(marker.location, GLOBE_BOX)
        return position ? [{ ...position, label: marker.label }] : []
      }),
    }
  }

  /**
   * Inset of one Earth reference region: one pre-built URL per context
   * layer (the first is the default), and a numbered marker per candidate.
   */
  inset(extent: RegionExtent, candidates: RankedMarkerInput[]) {
    const box = this.insetBox(extent)
    return {
      box,
      size: INSET_SIZE,
      outline: this.outline(extent, box),
      layers: INSET_LAYERS.map((layer) => ({
        id: layer.id,
        label: layer.label,
        caption: layer.caption,
        legend: layer.legend ?? null,
        src: this.gibsUrl(layer, box, INSET_SIZE, INSET_SIZE),
      })),
      markers: groupMarkers(
        candidates.flatMap((candidate) => {
          const position = this.project(candidate.location, box)
          return position ? [{ ...position, rank: candidate.rank, cellId: candidate.cellId }] : []
        })
      ),
    }
  }

  /**
   * The region's cells (centers ± half a cell) as a rectangle in percent of
   * `box`, for a dashed outline on the inset.
   */
  outline(extent: RegionExtent, box: BoundingBox) {
    const midLat = (extent.minLatitude + extent.maxLatitude) / 2
    const halfLon = HALF_CELL_DEG / Math.cos((midLat * Math.PI) / 180)
    const width = box.east - box.west
    const height = box.north - box.south
    return {
      leftPct: round2(((extent.minLongitude - halfLon - box.west) / width) * 100),
      topPct: round2(((box.north - extent.maxLatitude - HALF_CELL_DEG) / height) * 100),
      widthPct: round2(((extent.maxLongitude - extent.minLongitude + 2 * halfLon) / width) * 100),
      heightPct: round2(
        ((extent.maxLatitude - extent.minLatitude + 2 * HALF_CELL_DEG) / height) * 100
      ),
    }
  }

  /** Meridians and parallels every 30°, as percent offsets; 0° is flagged. */
  graticule() {
    const lines = (from: number, to: number) => {
      const values: number[] = []
      for (let value = from; value <= to; value += GRATICULE_STEP_DEG) {
        values.push(value)
      }
      return values
    }
    return {
      meridians: lines(-150, 150).map((longitude) => ({
        longitude,
        leftPct: round2(((longitude + 180) / 360) * 100),
        primary: longitude === 0,
      })),
      parallels: lines(-60, 60).map((latitude) => ({
        latitude,
        topPct: round2(((90 - latitude) / 180) * 100),
        primary: latitude === 0,
      })),
    }
  }
}

export interface MarkerGroup extends MapPosition {
  /** Ranked candidates drawn together, best rank first. */
  members: { rank: number; cellId: string }[]
  /**
   * The pill grows to the right of its point, or to the left when it would
   * run past the frame's right edge. The best-ranked marker is always the
   * one on the point.
   */
  direction: 'right' | 'left'
}

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/** The area a group's pill covers, in percent of the frame. */
function footprint(group: Omit<MarkerGroup, 'direction'>, direction: 'right' | 'left'): Rect {
  const count = group.members.length
  const length = count * MARKER_SLOT_PCT + (count - 1) * MARKER_GAP_PCT
  const half = MARKER_SLOT_PCT / 2
  const left = direction === 'right' ? group.leftPct - half : group.leftPct + half - length
  return { left, right: left + length, top: group.topPct - half, bottom: group.topPct + half }
}

function pillDirection(group: Omit<MarkerGroup, 'direction'>): 'right' | 'left' {
  return footprint(group, 'right').right > 100 ? 'left' : 'right'
}

function overlaps(a: Rect, b: Rect) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * Merges markers whose pills would overlap, so every rank stays visible and
 * clickable. In rank order, a marker joins the first group it would overlap
 * or starts a new one; a group that grows is merged with any group it now
 * overlaps, until none do. A group sits at its best-ranked member's point.
 */
export function groupMarkers(
  markers: (MapPosition & { rank: number; cellId: string })[]
): MarkerGroup[] {
  const groups: MarkerGroup[] = []
  const rectOf = (group: MarkerGroup) => footprint(group, group.direction)

  for (const marker of [...markers].sort((a, b) => a.rank - b.rank)) {
    const single: MarkerGroup = {
      leftPct: marker.leftPct,
      topPct: marker.topPct,
      members: [{ rank: marker.rank, cellId: marker.cellId }],
      direction: 'right',
    }
    single.direction = pillDirection(single)

    const hit = groups.find((entry) => overlaps(rectOf(entry), rectOf(single)))
    if (!hit) {
      groups.push(single)
      continue
    }
    hit.members.push(...single.members)
    hit.direction = pillDirection(hit)

    // A longer pill may now cover another group: merge them, and repeat.
    let group: MarkerGroup = hit
    for (;;) {
      const current = group
      const other = groups.find(
        (entry) => entry !== current && overlaps(rectOf(entry), rectOf(current))
      )
      if (!other) {
        break
      }
      const keep = other.members[0].rank < current.members[0].rank ? other : current
      const drop = keep === other ? current : other
      keep.members = [...keep.members, ...drop.members].sort((a, b) => a.rank - b.rank)
      keep.direction = pillDirection(keep)
      groups.splice(groups.indexOf(drop), 1)
      group = keep
    }
  }
  return groups.sort((a, b) => a.members[0].rank - b.members[0].rank)
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6
}
