import vine, { SimpleMessagesProvider } from '@vinejs/vine'
import type DiscoveryService from '#services/discovery_service'
import {
  DEFAULT_TOP_N,
  MAX_TOP_N,
  type Catalog,
  type DiscoveryConfig,
  type ReferenceRegion,
} from '#services/discovery_service'

const messages = new SimpleMessagesProvider({
  'world.required': 'Choose a target world.',
  'world.enum': 'Choose the Moon or Mars as the target world.',
  'region.required': 'Choose a target region.',
  'region.enum': 'Choose a target region on the selected world.',
  'reference.required': 'Choose an Earth reference region.',
  'reference.enum': 'Choose an available Earth reference region.',
  'features.required': 'Select at least one terrain feature.',
  'features.array': 'Select at least one terrain feature.',
  'features.array.minLength': 'Select at least one terrain feature.',
  'features.array.maxLength': 'Select each terrain feature at most once.',
  'features.distinct': 'Each terrain feature can be selected only once.',
  'features.*.enum': 'One of the selected terrain features is not available.',
  'topN.number': 'Enter a whole number of candidates per target cell.',
  'topN.withoutDecimals': 'Enter a whole number of candidates per target cell.',
  'topN.range': `Choose between 1 and ${MAX_TOP_N} candidates per target cell.`,
})

/**
 * Builds the VineJS validator from the catalog, so it accepts exactly the
 * worlds, regions, reference regions, and features the data offers. New
 * Earth regions from Hein's pipeline are accepted without code changes.
 */
function buildValidator(catalog: Catalog, references: ReferenceRegion[]) {
  const regionsByWorld = new Map<string, string[]>()
  for (const region of catalog.regions) {
    if (region.role === 'target') {
      regionsByWorld.set(region.worldId, [
        ...(regionsByWorld.get(region.worldId) ?? []),
        region.region,
      ])
    }
  }
  const featureIds = catalog.features.map((feature) => feature.id)

  const validator = vine.create({
    world: vine.enum(catalog.worlds.map((world) => world.id)),
    region: vine.enum((field) => regionsByWorld.get(String(field.parent?.world)) ?? []),
    reference: vine.enum(references.map((reference) => reference.region)),
    features: vine
      .array(vine.enum(featureIds))
      .minLength(1)
      .maxLength(featureIds.length)
      .distinct(),
    topN: vine.number().withoutDecimals().range([1, MAX_TOP_N]).optional(),
  })
  validator.messagesProvider = messages
  return validator
}

type DiscoveryValidator = ReturnType<typeof buildValidator>

/** One compiled validator per DiscoveryService (i.e. per app). */
const validators = new WeakMap<DiscoveryService, Promise<DiscoveryValidator>>()

function validatorFor(discovery: DiscoveryService): Promise<DiscoveryValidator> {
  let validator = validators.get(discovery)
  if (!validator) {
    validator = Promise.all([discovery.catalog(), discovery.referenceRegions()]).then(
      ([catalog, references]) => buildValidator(catalog, references)
    )
    validator.catch(() => validators.delete(discovery))
    validators.set(discovery, validator)
  }
  return validator
}

/**
 * Validates a discovery request (typically `request.qs()`) and returns the
 * configuration DiscoveryService expects. Throws VineJS's E_VALIDATION_ERROR
 * (HTTP 422) with one message per invalid field.
 *
 * A single checkbox value can arrive as a string (`features=a` instead of
 * `features[]=a`), so it is wrapped in an array first. `topN` defaults to
 * DEFAULT_TOP_N when missing.
 */
export async function validateDiscovery(
  discovery: DiscoveryService,
  data: Record<string, unknown>
): Promise<DiscoveryConfig> {
  const input = { ...data }
  if (typeof input.features === 'string') {
    input.features = [input.features]
  }
  if (input.topN === '') {
    delete input.topN
  }

  const validator = await validatorFor(discovery)
  const output = await validator.validate(input)
  return {
    world: output.world,
    region: output.region,
    reference: output.reference,
    features: output.features,
    topN: output.topN ?? DEFAULT_TOP_N,
  }
}
