import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { errors } from '@vinejs/vine'
import { listValue } from '@duckdb/node-api'
import DiscoveryService from '#services/discovery_service'
import type { DiscoveryConfig } from '#services/discovery_service'
import type DuckDbService from '#services/duckdb_service'
import { MAX_TOP_N } from '#services/discovery_service'
import { openTerraTwin } from '#tests/helpers/terratwin'

test('the container provides one shared DiscoveryService', async ({ assert }) => {
  const first = await app.container.make(DiscoveryService)
  assert.instanceOf(first, DiscoveryService)
  assert.strictEqual(await app.container.make(DiscoveryService), first)
})

const ALL_FEATURES = ['mean_slope_deg', 'robust_relief_m', 'slope_stddev_deg']

function moon(overrides: Partial<DiscoveryConfig> = {}): DiscoveryConfig {
  return {
    world: 'Moon',
    region: 'South_Pole',
    reference: 'Atacama',
    features: ALL_FEATURES,
    topN: 10,
    ...overrides,
  }
}

/** Fields named by a VineJS validation error, or rethrows anything else. */
async function invalidFields(promise: Promise<unknown>): Promise<string[] | null> {
  try {
    await promise
    return null
  } catch (error) {
    if (error instanceof errors.E_VALIDATION_ERROR) {
      return error.messages.map((message: { field: string }) => message.field)
    }
    throw error
  }
}

test.group('DiscoveryService', (group) => {
  let discovery: DiscoveryService
  let db: DuckDbService

  group.setup(async () => {
    const terraTwin = await openTerraTwin()
    discovery = terraTwin.discovery
    db = terraTwin.db
    return () => terraTwin.close()
  })

  test('catalog lists target worlds, their regions, and features', async ({ assert }) => {
    const catalog = await discovery.catalog()

    assert.deepEqual(
      catalog.worlds.map((world) => world.id),
      ['Moon', 'Mars']
    )
    assert.deepInclude(
      catalog.regions.map(({ id, worldId, region, role }) => ({ id, worldId, region, role })),
      { id: 'Moon:South_Pole', worldId: 'Moon', region: 'South_Pole', role: 'target' }
    )
    assert.deepInclude(
      catalog.regions.map(({ worldId, region, role }) => ({ worldId, region, role })),
      { worldId: 'Earth', region: 'Atacama', role: 'candidate' }
    )
    assert.deepEqual(
      catalog.features.map((feature) => feature.id),
      ALL_FEATURES
    )
    assert.isTrue(catalog.features.every((feature) => feature.defaultSelected))
    assert.strictEqual(await discovery.catalog(), catalog, 'catalog is loaded once')
  })

  test('reference regions come from the Earth cells', async ({ assert }) => {
    const references = await discovery.referenceRegions()

    assert.deepEqual(
      references.map(({ id, region }) => ({ id, region })),
      [{ id: 'Earth:Atacama', region: 'Atacama' }]
    )
    assert.isAbove(references[0].eligibleCellCount, 0)
  })

  test('a custom run with all three features matches the baseline', async ({ assert }) => {
    const [run, baseline] = await Promise.all([
      discovery.run(moon()),
      discovery.baseline('Moon', 'South_Pole'),
    ])

    assert.deepEqual(run.summary, baseline.summary)
    assert.deepEqual(run.diversity, baseline.diversity)
    assert.isAbove(run.summary.targetCellCount, 0)
    assert.isNumber(run.summary.targetCellCount, 'BIGINT counts are cast to numbers')
  })

  test('the cell grid covers every target cell and ranks only eligible ones', async ({
    assert,
  }) => {
    const run = await discovery.run(moon())

    const eligible = run.cells.filter((cell) => cell.eligible)
    const ineligible = run.cells.filter((cell) => !cell.eligible)
    assert.isAbove(ineligible.length, 0, 'fixture has low-coverage cells')
    assert.lengthOf(eligible, run.summary.targetCellCount)
    assert.isTrue(eligible.every((cell) => cell.bestDistance !== null))
    assert.isTrue(ineligible.every((cell) => cell.bestDistance === null))
    assert.isTrue(ineligible.every((cell) => cell.validPixelFraction < 0.95))

    const best = eligible.reduce((a, b) => (b.bestDistance! < a.bestDistance! ? b : a))
    assert.equal(run.bestCellId, best.cellId)
    assert.closeTo(best.bestDistance!, run.summary.minBestDistance!, 0.0001)
  })

  test('cell candidates are ordered by rank and limited to topN', async ({ assert }) => {
    const run = await discovery.run(moon())
    const result = await discovery.cellCandidates(moon({ topN: 5 }), run.bestCellId!)

    assert.isNotNull(result)
    assert.equal(result!.target.cellId, run.bestCellId)
    assert.deepEqual(
      result!.candidates.map((candidate) => candidate.rank),
      [1, 2, 3, 4, 5]
    )
    const distances = result!.candidates.map((candidate) => candidate.distance)
    assert.deepEqual(
      distances,
      [...distances].sort((a, b) => a - b)
    )
    assert.isTrue(result!.candidates.every((candidate) => candidate.region === 'Atacama'))
    assert.isNumber(result!.candidates[0].location.latitude)
    assert.isNumber(result!.candidates[0].terrain.meanSlopeDeg)
  })

  test('cell candidates for an unknown cell are null', async ({ assert }) => {
    assert.isNull(await discovery.cellCandidates(moon(), 'moon_south_south_pole_r999_c999'))
  })

  test('unselected features have null differences', async ({ assert }) => {
    const config = moon({ features: ['robust_relief_m'] })
    const run = await discovery.run(config)
    const result = await discovery.cellCandidates(config, run.bestCellId!)
    const top = result!.candidates[0]

    assert.isNull(top.featureDifferences.meanSlopeZ)
    assert.isNull(top.featureDifferences.slopeVariabilityZ)
    assert.isNumber(top.featureDifferences.robustReliefZ)
    assert.closeTo(top.distance, Math.abs(top.featureDifferences.robustReliefZ!), 1e-9)
  })

  test('feature order does not create a second ranking', async ({ assert }) => {
    await discovery.run(
      moon({ world: 'Mars', region: 'Jezero', features: ['mean_slope_deg', 'slope_stddev_deg'] })
    )
    const reordered = await discovery.run(
      moon({ world: 'Mars', region: 'Jezero', features: ['slope_stddev_deg', 'mean_slope_deg'] })
    )

    assert.isTrue(reordered.timing.rankingCached)
    assert.equal(reordered.timing.rankingMs, 0)
  })

  test('concurrent runs of one configuration rank it once', async ({ assert }) => {
    const config = moon({ features: ['mean_slope_deg', 'robust_relief_m'] })
    const runs = await Promise.all([
      discovery.run(config),
      discovery.run(config),
      discovery.run(config),
    ])
    const later = await discovery.run(config)

    assert.isTrue(later.timing.rankingCached)
    const counts = await db.all<{ rows: number; distinct_rows: number }>(
      `SELECT COUNT(*)::INTEGER AS rows,
              COUNT(DISTINCT (target_cell_id, rank))::INTEGER AS distinct_rows
       FROM discovery_cache
       WHERE config_key = discovery_config_key($world, $region, $reference, $features)`,
      {
        world: 'Moon',
        region: 'South_Pole',
        reference: 'Atacama',
        features: listValue(config.features),
      }
    )
    assert.equal(counts[0].rows, counts[0].distinct_rows, 'no duplicate cache rows')
    assert.equal(counts[0].rows, runs[0].summary.targetCellCount * MAX_TOP_N)
  })

  test('candidate details follow the API contract and match the ranked list', async ({
    assert,
  }) => {
    const config = moon({ features: ['mean_slope_deg', 'robust_relief_m'] })
    const run = await discovery.run(config)
    const ranked = await discovery.cellCandidates(config, run.bestCellId!)
    const details = await discovery.candidateDetails(config, run.bestCellId!, 2)

    assert.isNotNull(details)
    assert.equal(details!.target.cellId, run.bestCellId)
    assert.equal(details!.target.planet, 'Moon')
    assert.equal(details!.candidate.planet, 'Earth')
    assert.equal(details!.candidate.cellId, ranked!.candidates[1].cellId)
    assert.equal(details!.comparison.rank, 2)
    assert.closeTo(details!.comparison.distance, ranked!.candidates[1].distance, 1e-12)
    assert.isNull(details!.comparison.featureDifferences.slopeVariabilityZ)
    assert.isNumber(details!.target.terrain.meanElevationM)
    assert.isNumber(details!.candidate.dataQuality.validPixelFraction)
    assert.deepEqual(details!.configuration, {
      referenceRegion: 'Atacama',
      selectedFeatures: ['mean_slope_deg', 'robust_relief_m'],
    })
  })

  test('candidate details for a missing rank are null', async ({ assert }) => {
    assert.isNull(await discovery.candidateDetails(moon(), 'moon_south_south_pole_r999_c999', 1))
  })

  test('the baseline example features the target cell with the closest match', async ({
    assert,
  }) => {
    const example = await discovery.baseline('Mars', 'Jezero')

    assert.isNotNull(example.featured)
    assert.lengthOf(example.featured!.candidates, 3)
    assert.closeTo(
      example.featured!.candidates[0].distance,
      example.summary.minBestDistance!,
      0.0001
    )
    assert.equal(example.reference, 'Atacama')
  })

  test('run_discovery errors become validation errors on the right field', async ({ assert }) => {
    assert.deepEqual(await invalidFields(discovery.run(moon({ features: [] }))), ['features'])
    assert.deepEqual(
      await invalidFields(discovery.run(moon({ features: ['mean_slope_deg', 'mean_slope_deg'] }))),
      ['features']
    )
    assert.deepEqual(await invalidFields(discovery.run(moon({ features: ['elevation'] }))), [
      'features',
    ])
    assert.deepEqual(await invalidFields(discovery.run(moon({ world: 'Venus' }))), ['world'])
    assert.deepEqual(await invalidFields(discovery.run(moon({ region: 'Nowhere' }))), ['region'])
    assert.deepEqual(await invalidFields(discovery.run(moon({ reference: 'Nowhere' }))), [
      'reference',
    ])
  })

  test('a failed ranking is not cached', async ({ assert }) => {
    const config = moon({ region: 'Nowhere' })
    assert.deepEqual(await invalidFields(discovery.run(config)), ['region'])
    assert.deepEqual(await invalidFields(discovery.run(config)), ['region'])
  })

  test('region extent is the bounding box of the region cells', async ({ assert }) => {
    const extent = await discovery.regionExtent('Earth', 'Atacama')

    assert.isNotNull(extent)
    assert.isBelow(extent!.minLatitude, extent!.maxLatitude)
    assert.isBelow(extent!.minLongitude, extent!.maxLongitude)
    assert.isAbove(extent!.cellCount, 0)
    assert.isNull(await discovery.regionExtent('Earth', 'Nowhere'))
  })
})
