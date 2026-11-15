import { errors } from '@vinejs/vine'

/**
 * Errors that Hein's run_discovery macro raises with DuckDB's error(), mapped
 * to the form field the user can fix. The validator should reject these
 * inputs first; this is the safety net if one reaches DuckDB anyway.
 */
const KNOWN_ERRORS: { match: string; field: string; message: string }[] = [
  {
    match: 'Select at least one feature',
    field: 'features',
    message: 'Select at least one terrain feature.',
  },
  {
    match: 'Duplicate feature IDs are not allowed',
    field: 'features',
    message: 'Each terrain feature can be selected only once.',
  },
  {
    match: 'Unknown feature ID supplied',
    field: 'features',
    message: 'One of the selected terrain features is not available.',
  },
  {
    match: 'p_top_n must be greater than zero',
    field: 'topN',
    message: 'Choose at least 1 candidate per target cell.',
  },
  {
    match: 'Unsupported target planet',
    field: 'world',
    message: 'Choose the Moon or Mars as the target world.',
  },
  {
    match: 'No eligible target cells',
    field: 'region',
    message: 'This target region has no cells with enough data coverage.',
  },
  {
    match: 'No eligible Earth reference cells',
    field: 'reference',
    message: 'This Earth reference region has no cells with enough data coverage.',
  },
  {
    match: 'Invalid Earth reference scale',
    field: 'features',
    message:
      'A selected feature does not vary across the Earth reference region, so it cannot be compared. Remove it and try again.',
  },
  {
    match: 'Missing Earth reference scale',
    field: 'features',
    message: 'A selected feature has no values in the Earth reference region.',
  },
]

/**
 * Returns a VineJS validation error (HTTP 422, same shape as the
 * validator's errors) for a known run_discovery error, or the original error
 * unchanged for anything else.
 */
export function translateDiscoveryError(error: unknown): unknown {
  const text = error instanceof Error ? error.message : String(error)
  const known = KNOWN_ERRORS.find((entry) => text.includes(entry.match))
  if (!known) {
    return error
  }
  return new errors.E_VALIDATION_ERROR(
    [{ field: known.field, message: known.message, rule: 'discovery' }],
    { cause: error }
  )
}
