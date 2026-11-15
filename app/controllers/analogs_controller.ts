import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { errors } from '@vinejs/vine'
import {
  defaultConfig,
  formState,
  presentBaseline,
  presentCandidateDetail,
  presentCellCandidates,
  presentRun,
  regionOptions,
} from '#presenters/discovery_presenter'
import DiscoveryService, { MAX_TOP_N } from '#services/discovery_service'
import type {
  Catalog,
  CellCandidates,
  DiscoveryConfig,
  ReferenceRegion,
} from '#services/discovery_service'
import MapSnapshotService from '#services/map_snapshot_service'
import { validateDiscovery } from '#validators/discovery_validator'

interface Problem {
  field?: string
  message: string
}

/**
 * The single-page discovery journey: Explore → Configure → Analyze →
 * Understand. `home` renders the full page; the `/partials/*` actions return
 * HTML fragments that Alpine's `$swap` puts into the page.
 *
 * The configuration always travels in the query string, so the server keeps
 * no state and every result URL reproduces its result.
 */
@inject()
export default class AnalogsController {
  constructor(
    protected discovery: DiscoveryService,
    protected maps: MapSnapshotService
  ) {}

  /**
   * GET / : Explore cards and the Configure form. When the URL carries a
   * configuration (a shared link, or the form submitted without JavaScript),
   * the results are rendered into the page as well. `cell` selects the
   * target cell whose candidates are shown.
   */
  async home({ request, view }: HttpContext) {
    const [catalog, references] = await this.#catalog()
    const qs = request.qs()

    let config = defaultConfig(catalog, references)
    let results = null
    let detail = null
    let problems: Problem[] = []
    if (qs.world !== undefined) {
      try {
        config = await validateDiscovery(this.discovery, qs)
        results = await this.#results(config, catalog, references, stringParam(qs.cell))
        // `inspect=N` opens candidate N of the selected cell (a shared link).
        const rank = rankParam(qs.inspect)
        if (rank !== null && results.selectedCellId) {
          detail = await this.#detail(config, results.selectedCellId, rank, catalog, references)
        }
      } catch (error) {
        problems = toProblems(error)
      }
    }

    return view.render('pages/home', {
      baselines: await this.#baselines(catalog),
      earthMap: await this.#earthMap(references),
      form: formState(config, catalog, references),
      regions: regionOptions(catalog, config.world, config.region),
      results,
      detail,
      problems,
    })
  }

  /** GET /partials/regions?world=Moon : region radios for one world. */
  async regions({ request, response, view }: HttpContext) {
    const catalog = await this.discovery.catalog()
    const regions = regionOptions(catalog, stringParam(request.qs().world) ?? '')
    if (regions.length === 0) {
      response.status(422)
      return view.render('partials/problems', {
        problems: [{ field: 'world', message: 'Choose the Moon or Mars as the target world.' }],
      })
    }
    return view.render('partials/region_list', { regions })
  }

  /** GET /partials/discover?… : run summary, cell grid, and best cell. */
  async discover({ request, response, view }: HttpContext) {
    const [catalog, references] = await this.#catalog()
    try {
      const config = await validateDiscovery(this.discovery, request.qs())
      const results = await this.#results(config, catalog, references)
      return view.render('partials/discovery_results', { results })
    } catch (error) {
      const problems = toProblems(error)
      response.status(422)
      return view.render('partials/problems', { problems })
    }
  }

  /** GET /partials/cells/:cellId?… : ranked Earth candidates for one cell. */
  async cell({ params, request, response, view }: HttpContext) {
    const [catalog, references] = await this.#catalog()
    let config: DiscoveryConfig
    try {
      config = await validateDiscovery(this.discovery, request.qs())
    } catch (error) {
      const problems = toProblems(error)
      response.status(422)
      return view.render('partials/problems', { problems })
    }

    const result = await this.discovery.cellCandidates(config, params.cellId)
    if (!result) {
      response.status(404)
      return view.render('partials/problems', {
        problems: [
          {
            message:
              'This cell has no ranked Earth candidates. It may be excluded for low data coverage.',
          },
        ],
      })
    }
    return view.render('partials/cell_candidates', {
      cell: await this.#cellView(result, config, catalog, references),
    })
  }

  /**
   * GET /partials/candidates/:cellId/:rank?… : the detail of one ranked
   * candidate, swapped into the detail dialog.
   */
  async candidate({ params, request, response, view }: HttpContext) {
    const [catalog, references] = await this.#catalog()
    let config: DiscoveryConfig
    try {
      config = await validateDiscovery(this.discovery, request.qs())
    } catch (error) {
      response.status(422)
      return view.render('partials/problems', { problems: toProblems(error) })
    }

    const rank = rankParam(params.rank)
    const detail =
      rank === null ? null : await this.#detail(config, params.cellId, rank, catalog, references)
    if (!detail) {
      response.status(404)
      return view.render('partials/problems', {
        problems: [{ message: 'This candidate is not in the ranking for this configuration.' }],
      })
    }
    return view.render('partials/candidate_detail', { detail })
  }

  /**
   * Candidate detail plus where both cells are: the Earth cell on the
   * reference-region inset and the target cell on the region's cell grid.
   */
  async #detail(
    config: DiscoveryConfig,
    cellId: string,
    rank: number,
    catalog: Catalog,
    references: ReferenceRegion[]
  ) {
    const [details, run, extent] = await Promise.all([
      this.discovery.candidateDetails(config, cellId, rank),
      this.discovery.run(config),
      this.discovery.regionExtent('Earth', config.reference),
    ])
    if (!details) {
      return null
    }
    const grid = presentRun(run, catalog, references).grid
    return {
      ...presentCandidateDetail(details, config, catalog, references),
      map: extent
        ? this.maps.inset(extent, [
            { rank, cellId: details.candidate.cellId, location: details.candidate.location },
          ])
        : null,
      grid: {
        columns: grid.columns,
        rows: grid.rows,
        cells: grid.cells.map((cell) => ({
          row: cell.row,
          col: cell.col,
          eligible: cell.eligible,
          target: cell.cellId === details.target.cellId,
        })),
      },
    }
  }

  #catalog(): Promise<[Catalog, ReferenceRegion[]]> {
    return Promise.all([this.discovery.catalog(), this.discovery.referenceRegions()])
  }

  /** Run summary + grid, plus candidates for the requested or best cell. */
  async #results(
    config: DiscoveryConfig,
    catalog: Catalog,
    references: ReferenceRegion[],
    cellId?: string
  ) {
    const run = await this.discovery.run(config)
    const rankedCell = run.cells.find(
      (cell) => cell.cellId === cellId && cell.bestDistance !== null
    )
    const selectedCellId = rankedCell?.cellId ?? run.bestCellId
    const candidates = selectedCellId
      ? await this.discovery.cellCandidates(config, selectedCellId)
      : null

    return {
      ...presentRun(run, catalog, references),
      selectedCellId,
      cell: candidates ? await this.#cellView(candidates, config, catalog, references) : null,
    }
  }

  /** Candidate cards plus the reference-region inset with their markers. */
  async #cellView(
    result: CellCandidates,
    config: DiscoveryConfig,
    catalog: Catalog,
    references: ReferenceRegion[]
  ) {
    const extent = await this.discovery.regionExtent('Earth', config.reference)
    const label =
      references.find((reference) => reference.region === config.reference)?.label ??
      config.reference
    return {
      ...presentCellCandidates(result, config, catalog),
      map: extent
        ? {
            title: `Earth · ${label}`,
            ...this.maps.inset(extent, result.candidates),
          }
        : null,
    }
  }

  /** Full-globe Earth map with one marker per Earth reference region. */
  async #earthMap(references: ReferenceRegion[]) {
    const markers = await Promise.all(
      references.map(async (reference) => {
        const extent = await this.discovery.regionExtent('Earth', reference.region)
        return extent
          ? [
              {
                label: reference.label,
                location: {
                  latitude: (extent.minLatitude + extent.maxLatitude) / 2,
                  longitude: (extent.minLongitude + extent.maxLongitude) / 2,
                },
              },
            ]
          : []
      })
    )
    return this.maps.globe(markers.flat())
  }

  /** One Explore card per target region, from Hein's baseline ranking. */
  #baselines(catalog: Catalog) {
    const targets = catalog.regions.filter((region) => region.role === 'target')
    return Promise.all(
      targets.map(async (region) =>
        presentBaseline(await this.discovery.baseline(region.worldId, region.region), catalog)
      )
    )
  }
}

/** A candidate rank from the URL: a whole number from 1 to MAX_TOP_N. */
function rankParam(value: unknown): number | null {
  const rank = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isInteger(rank) && rank >= 1 && rank <= MAX_TOP_N ? rank : null
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Validation errors become readable problems; anything else propagates. */
function toProblems(error: unknown): Problem[] {
  if (error instanceof errors.E_VALIDATION_ERROR) {
    return error.messages.map((message: { field: string; message: string }) => ({
      field: message.field,
      message: message.message,
    }))
  }
  throw error
}
