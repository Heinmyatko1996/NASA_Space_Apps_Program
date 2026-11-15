import { test } from '@japa/runner'
import { errors } from '@vinejs/vine'
import type DiscoveryService from '#services/discovery_service'
import { DEFAULT_TOP_N } from '#services/discovery_service'
import { validateDiscovery } from '#validators/discovery_validator'
import { openTerraTwin } from '#tests/helpers/terratwin'

const VALID = {
  world: 'Moon',
  region: 'South_Pole',
  reference: 'Atacama',
  features: ['mean_slope_deg', 'robust_relief_m'],
  topN: '10',
}

/** VALID without one field. */
function without(field: keyof typeof VALID): Record<string, unknown> {
  const input: Record<string, unknown> = { ...VALID }
  delete input[field]
  return input
}

/** Field → message for a VineJS validation error, or rethrows anything else. */
async function invalid(promise: Promise<unknown>): Promise<Record<string, string>> {
  try {
    await promise
  } catch (error) {
    if (error instanceof errors.E_VALIDATION_ERROR) {
      return Object.fromEntries(
        error.messages.map((message: { field: string; message: string }) => [
          message.field.split('.')[0],
          message.message,
        ])
      )
    }
    throw error
  }
  throw new Error('Expected a validation error')
}

test.group('validateDiscovery', (group) => {
  let discovery: DiscoveryService

  group.setup(async () => {
    const terraTwin = await openTerraTwin()
    discovery = terraTwin.discovery
    return () => terraTwin.close()
  })

  test('accepts a valid request and casts topN to a number', async ({ assert }) => {
    assert.deepEqual(await validateDiscovery(discovery, VALID), {
      world: 'Moon',
      region: 'South_Pole',
      reference: 'Atacama',
      features: ['mean_slope_deg', 'robust_relief_m'],
      topN: 10,
    })
  })

  test('wraps a single feature string in an array', async ({ assert }) => {
    const config = await validateDiscovery(discovery, { ...VALID, features: 'mean_slope_deg' })
    assert.deepEqual(config.features, ['mean_slope_deg'])
  })

  test('defaults topN when it is missing or empty', async ({ assert }) => {
    const missing = await validateDiscovery(discovery, without('topN'))
    const empty = await validateDiscovery(discovery, { ...VALID, topN: '' })
    assert.equal(missing.topN, DEFAULT_TOP_N)
    assert.equal(empty.topN, DEFAULT_TOP_N)
  })

  test('rejects a world that is not a target world', async ({ assert }) => {
    const fields = await invalid(validateDiscovery(discovery, { ...VALID, world: 'Earth' }))
    assert.equal(fields.world, 'Choose the Moon or Mars as the target world.')
  })

  test('rejects a region from another world', async ({ assert }) => {
    const fields = await invalid(validateDiscovery(discovery, { ...VALID, region: 'Jezero' }))
    assert.equal(fields.region, 'Choose a target region on the selected world.')
    assert.notProperty(fields, 'world')
  })

  test('rejects an Earth reference region the data does not have', async ({ assert }) => {
    const fields = await invalid(validateDiscovery(discovery, { ...VALID, reference: 'Sahara' }))
    assert.property(fields, 'reference')
  })

  test('rejects empty, unknown, and duplicate features', async ({ assert }) => {
    const empty = await invalid(validateDiscovery(discovery, { ...VALID, features: [] }))
    const missing = await invalid(validateDiscovery(discovery, without('features')))
    const unknown = await invalid(
      validateDiscovery(discovery, { ...VALID, features: ['elevation'] })
    )
    assert.equal(empty.features, 'Select at least one terrain feature.')
    assert.equal(missing.features, 'Select at least one terrain feature.')
    assert.equal(unknown.features, 'One of the selected terrain features is not available.')
    assert.property(
      await invalid(
        validateDiscovery(discovery, { ...VALID, features: ['mean_slope_deg', 'mean_slope_deg'] })
      ),
      'features'
    )
  })

  test('rejects topN outside 1-25 or with decimals', async ({ assert }) => {
    for (const topN of ['0', '26', '2.5', 'ten']) {
      const fields = await invalid(validateDiscovery(discovery, { ...VALID, topN }))
      assert.property(fields, 'topN', `topN=${topN}`)
    }
  })
})
