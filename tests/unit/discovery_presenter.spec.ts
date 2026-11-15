import { test } from '@japa/runner'
import {
  configQuery,
  formatCoordinates,
  formatDistance,
  presentCellCandidates,
  presentRun,
} from '#presenters/discovery_presenter'
import type {
  Catalog,
  CellCandidates,
  DiscoveryConfig,
  DiscoveryRun,
  GridCell,
} from '#services/discovery_service'

const CATALOG: Catalog = {
  worlds: [{ id: 'Moon', label: 'Moon', regionCount: 1 }],
  regions: [
    {
      id: 'Moon:South_Pole',
      worldId: 'Moon',
      region: 'South_Pole',
      label: 'South Pole',
      role: 'target',
      eligibleCellCount: 3,
    },
  ],
  features: [
    {
      id: 'mean_slope_deg',
      label: 'Mean slope',
      unit: 'degrees',
      description: '',
      defaultSelected: true,
      sortOrder: 1,
    },
    {
      id: 'robust_relief_m',
      label: 'Robust relief',
      unit: 'metres',
      description: '',
      defaultSelected: true,
      sortOrder: 2,
    },
    {
      id: 'slope_stddev_deg',
      label: 'Slope variability',
      unit: 'degrees',
      description: '',
      defaultSelected: true,
      sortOrder: 3,
    },
  ],
}
const REFERENCES = [
  {
    id: 'Earth:Atacama',
    worldId: 'Earth',
    region: 'Atacama',
    label: 'Atacama',
    eligibleCellCount: 3,
    gridResolutionM: 500,
  },
]
const CONFIG: DiscoveryConfig = {
  world: 'Moon',
  region: 'South_Pole',
  reference: 'Atacama',
  features: ['mean_slope_deg', 'robust_relief_m'],
  topN: 2,
}

function gridCell(
  gridRow: number,
  gridCol: number,
  latitude: number,
  bestDistance: number | null
): GridCell {
  return {
    cellId: `c_r${gridRow}_c${gridCol}`,
    gridRow,
    gridCol,
    location: { latitude, longitude: 10 },
    eligible: bestDistance !== null,
    validPixelFraction: bestDistance === null ? 0.5 : 1,
    validSlopePixelFraction: bestDistance === null ? 0.5 : 1,
    bestEarthCellId: bestDistance === null ? null : 'e1',
    bestDistance,
  }
}

function run(cells: GridCell[]): DiscoveryRun {
  return {
    configuration: CONFIG,
    summary: {
      targetPlanet: 'Moon',
      targetRegion: 'South_Pole',
      referenceRegion: 'Atacama',
      targetCellCount: cells.filter((cell) => cell.eligible).length,
      minBestDistance: 0.1,
      q25BestDistance: 0.2,
      medianBestDistance: 0.3,
      q75BestDistance: 0.4,
      maxBestDistance: 0.9,
      meanBestDistance: 0.35,
    },
    diversity: {
      targetCellCount: 3,
      uniqueCandidateCount: 2,
      candidateDiversityPct: 66.67,
      maxCandidateReuseCount: 2,
      mostReusedCandidate: { cellId: 'e1', region: 'Atacama', count: 2, sharePct: 66.67 },
    },
    cells,
    bestCellId: cells[0]?.cellId ?? null,
    timing: { rankingMs: 300, rankingCached: false, totalMs: 320 },
  }
}

test.group('discovery presenter', () => {
  test('formats distances with two decimals and never as a percentage', ({ assert }) => {
    assert.equal(formatDistance(4.4972240634540315), '4.50')
    assert.equal(formatDistance(null), '—')
  })

  test('formats coordinates with hemispheres', ({ assert }) => {
    assert.equal(formatCoordinates({ latitude: -23.79, longitude: -69.62 }), '23.79° S, 69.62° W')
    assert.equal(formatCoordinates({ latitude: 18.4, longitude: 77.5 }), '18.40° N, 77.50° E')
  })

  test('the query string repeats features[] and round-trips topN', ({ assert }) => {
    const params = new URLSearchParams(configQuery(CONFIG))
    assert.deepEqual(params.getAll('features[]'), ['mean_slope_deg', 'robust_relief_m'])
    assert.equal(params.get('topN'), '2')
  })

  test('cells get quartile bands; excluded cells get none', ({ assert }) => {
    const view = presentRun(
      run([
        gridCell(0, 0, 10, 0.15),
        gridCell(0, 1, 10, 0.3),
        gridCell(1, 0, 9, 0.35),
        gridCell(1, 1, 9, 0.8),
        gridCell(2, 0, 8, null),
      ]),
      CATALOG,
      REFERENCES
    )

    assert.deepEqual(
      view.grid.cells.map((cell) => cell.band),
      [1, 2, 3, 4, null]
    )
    assert.deepEqual(
      view.grid.closest.map((cell) => cell.cellId),
      ['c_r0_c0', 'c_r0_c1', 'c_r1_c0', 'c_r1_c1']
    )
  })

  test('negative grid indexes start at 1, and north stays up', ({ assert }) => {
    // Latitude grows with grid_row here, so rows are flipped.
    const view = presentRun(
      run([gridCell(-2, -3, 1, 0.1), gridCell(0, -1, 5, 0.2)]),
      CATALOG,
      REFERENCES
    )

    assert.deepEqual(
      view.grid.cells.map(({ row, col }) => ({ row, col })),
      [
        { row: 3, col: 1 },
        { row: 1, col: 3 },
      ]
    )
    assert.equal(view.grid.rows, 3)
    assert.equal(view.grid.columns, 3)
  })

  test('feature bars are signed and scaled to the largest difference', ({ assert }) => {
    const result: CellCandidates = {
      target: {
        cellId: 't1',
        planet: 'Moon',
        region: 'South_Pole',
        location: { latitude: -88.4, longitude: 27.9 },
        terrain: { meanSlopeDeg: 14.9, robustReliefM: 1014.9, slopeStddevDeg: 2.76 },
      },
      candidates: [
        {
          rank: 1,
          distance: 4.4972,
          cellId: 'e1',
          region: 'Atacama',
          location: { latitude: -23.79, longitude: -69.62 },
          terrain: { meanSlopeDeg: 12.98, robustReliefM: 660.9, slopeStddevDeg: 5.08 },
          featureDifferences: {
            meanSlopeZ: 1.3615,
            robustReliefZ: 4.2862,
            slopeVariabilityZ: null,
          },
        },
        {
          rank: 2,
          distance: 4.6,
          cellId: 'e2',
          region: 'Atacama',
          location: { latitude: -23.8, longitude: -69.6 },
          terrain: { meanSlopeDeg: 16.0, robustReliefM: 600, slopeStddevDeg: 4.9 },
          featureDifferences: { meanSlopeZ: -0.8, robustReliefZ: 4.5, slopeVariabilityZ: null },
        },
      ],
    }

    const view = presentCellCandidates(result, CONFIG, CATALOG)

    assert.equal(view.scale, 5)
    const [slope, relief] = view.candidates[0].bars
    assert.deepEqual(
      { label: slope.label, z: slope.z, direction: slope.direction, widthPct: slope.widthPct },
      { label: 'Mean slope', z: '+1.36', direction: 'higher', widthPct: 27.2 }
    )
    assert.equal(relief.detail, 'target higher (1015 m vs 661 m)')
    assert.equal(view.candidates[1].bars[0].direction, 'lower')
    assert.lengthOf(view.candidates[0].bars, 2, 'only selected features get bars')
    assert.equal(view.candidates[0].distance, '4.50')
  })
})
