import { test } from '@japa/runner'
import MapSnapshotService, {
  GIBS_WMS_ENDPOINT,
  GLOBE_LAYER,
  INSET_LAYERS,
  groupMarkers,
} from '#services/map_snapshot_service'
import type { RegionExtent } from '#services/discovery_service'

/** Cell-center extent of the real Atacama reference region (rounded). */
const ATACAMA: RegionExtent = {
  minLatitude: -23.974,
  maxLatitude: -23.025,
  minLongitude: -70.016,
  maxLongitude: -68.987,
  cellCount: 449,
}

test.group('MapSnapshotService', () => {
  const maps = new MapSnapshotService()

  test('builds a WMS 1.3.0 GetMap URL with the BBOX in lat/lon order', ({ assert }) => {
    const url = new URL(
      maps.gibsUrl(INSET_LAYERS[0], { south: -24, west: -70, north: -23, east: -69 }, 640, 480)
    )

    assert.equal(`${url.origin}${url.pathname}`, GIBS_WMS_ENDPOINT)
    assert.equal(url.searchParams.get('VERSION'), '1.3.0')
    assert.equal(url.searchParams.get('REQUEST'), 'GetMap')
    assert.equal(url.searchParams.get('CRS'), 'EPSG:4326')
    assert.equal(url.searchParams.get('BBOX'), '-24,-70,-23,-69')
    assert.equal(url.searchParams.get('WIDTH'), '640')
    assert.equal(url.searchParams.get('HEIGHT'), '480')
    assert.equal(url.searchParams.get('LAYERS'), INSET_LAYERS[0].name)
    assert.equal(url.searchParams.get('TIME'), INSET_LAYERS[0].time)
  })

  test('static layers carry no TIME parameter', ({ assert }) => {
    const url = new URL(
      maps.gibsUrl(GLOBE_LAYER, { south: -90, west: -180, north: 90, east: 180 }, 2, 1)
    )
    assert.isFalse(url.searchParams.has('TIME'))
  })

  test('projects lat/lon linearly to percent of the box', ({ assert }) => {
    const box = { south: -90, west: -180, north: 90, east: 180 }

    assert.deepEqual(maps.project({ latitude: 90, longitude: -180 }, box), {
      leftPct: 0,
      topPct: 0,
    })
    assert.deepEqual(maps.project({ latitude: 0, longitude: 0 }, box), {
      leftPct: 50,
      topPct: 50,
    })
    assert.deepEqual(maps.project({ latitude: -45, longitude: 90 }, box), {
      leftPct: 75,
      topPct: 75,
    })
    assert.isNull(maps.project({ latitude: 0, longitude: 0 }, { ...box, west: 10 }))
  })

  test('the inset box holds the region and is square on the ground', ({ assert }) => {
    const box = maps.insetBox(ATACAMA)
    const midLat = (box.south + box.north) / 2
    const groundWidth = (box.east - box.west) * Math.cos((midLat * Math.PI) / 180)

    assert.isBelow(box.south, ATACAMA.minLatitude)
    assert.isAbove(box.north, ATACAMA.maxLatitude)
    assert.isBelow(box.west, ATACAMA.minLongitude)
    assert.isAbove(box.east, ATACAMA.maxLongitude)
    assert.closeTo(groundWidth, box.north - box.south, 1e-3)
  })

  test('the inset has a URL per layer, rank markers, and the region outline', ({ assert }) => {
    const inset = maps.inset(ATACAMA, [
      { rank: 1, cellId: 'a', location: { latitude: -23.5, longitude: -69.5 } },
      { rank: 2, cellId: 'b', location: { latitude: -23.025, longitude: -70.016 } },
      { rank: 3, cellId: 'far', location: { latitude: 10, longitude: 10 } },
    ])

    assert.deepEqual(
      inset.layers.map((layer) => layer.id),
      INSET_LAYERS.map((layer) => layer.id)
    )
    assert.deepEqual(
      inset.markers.map((group) => group.members.map((member) => member.rank)),
      [[1], [2]],
      'points outside the box are dropped'
    )
    const outline = inset.outline
    assert.isAbove(outline.leftPct, 0)
    assert.isAbove(outline.topPct, 0)
    assert.isBelow(outline.leftPct + outline.widthPct, 100)
    assert.isBelow(outline.topPct + outline.heightPct, 100)
    // The north-west cell center sits inside the outline, near its corner.
    const [, northWest] = inset.markers
    assert.isAbove(northWest.leftPct, outline.leftPct)
    assert.isAbove(northWest.topPct, outline.topPct)
  })

  test('markers that would overlap share one group, anchored at the best rank', ({ assert }) => {
    const groups = groupMarkers([
      { rank: 3, cellId: 'c', leftPct: 22, topPct: 41 },
      { rank: 1, cellId: 'a', leftPct: 20, topPct: 40 },
      { rank: 2, cellId: 'b', leftPct: 70, topPct: 70 },
      { rank: 4, cellId: 'd', leftPct: 20, topPct: 52 },
    ])

    assert.deepEqual(groups, [
      {
        leftPct: 20,
        topPct: 40,
        members: [
          { rank: 1, cellId: 'a' },
          { rank: 3, cellId: 'c' },
        ],
        direction: 'right',
      },
      { leftPct: 70, topPct: 70, members: [{ rank: 2, cellId: 'b' }], direction: 'right' },
      { leftPct: 20, topPct: 52, members: [{ rank: 4, cellId: 'd' }], direction: 'right' },
    ])
  })

  test('a growing pill absorbs a group it now covers', ({ assert }) => {
    // 1 and 2 are far enough apart alone; 3 joins 1, and the longer pill
    // (1·3) reaches 2, so all three end up in one group at rank 1's point.
    const groups = groupMarkers([
      { rank: 1, cellId: 'a', leftPct: 20, topPct: 40 },
      { rank: 2, cellId: 'b', leftPct: 32, topPct: 40 },
      { rank: 3, cellId: 'c', leftPct: 21, topPct: 42 },
    ])

    assert.lengthOf(groups, 1)
    assert.deepEqual(
      groups[0].members.map((member) => member.rank),
      [1, 2, 3]
    )
    assert.equal(groups[0].leftPct, 20)
  })

  test('a pill near the right edge grows leftwards', ({ assert }) => {
    const groups = groupMarkers([
      { rank: 1, cellId: 'a', leftPct: 95, topPct: 50 },
      { rank: 2, cellId: 'b', leftPct: 94, topPct: 51 },
    ])

    assert.lengthOf(groups, 1)
    assert.equal(groups[0].direction, 'left')
    assert.equal(groups[0].leftPct, 95)
  })

  test('the globe graticule has lines every 30° with the equator flagged', ({ assert }) => {
    const { meridians, parallels } = maps.graticule()

    assert.lengthOf(meridians, 11)
    assert.lengthOf(parallels, 5)
    assert.deepEqual(
      parallels.filter((line) => line.primary).map((line) => line.topPct),
      [50]
    )
    assert.deepEqual(
      meridians.filter((line) => line.primary).map((line) => line.leftPct),
      [50]
    )
  })
})
