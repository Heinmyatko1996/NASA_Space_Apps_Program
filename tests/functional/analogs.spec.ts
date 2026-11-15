import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import DiscoveryService from '#services/discovery_service'
import env from '#start/env'
import { openTerraTwin } from '#tests/helpers/terratwin'

const BASE = `http://${env.get('HOST')}:${env.get('PORT')}`
const CONFIG =
  'world=Moon&region=South_Pole&reference=Atacama' +
  '&features%5B%5D=mean_slope_deg&features%5B%5D=robust_relief_m&topN=4'

async function get(path: string) {
  const response = await fetch(`${BASE}${path}`)
  return { status: response.status, html: await response.text() }
}

function count(html: string, pattern: RegExp) {
  return html.match(pattern)?.length ?? 0
}

/**
 * The real routes and templates, with DiscoveryService swapped for one
 * backed by the synthetic fixture (no real Parquet files needed).
 */
test.group('Discovery pages', (group) => {
  group.setup(async () => {
    const terraTwin = await openTerraTwin()
    app.container.swap(DiscoveryService, () => terraTwin.discovery)
    return () => {
      app.container.restore(DiscoveryService)
      terraTwin.close()
    }
  })

  test('home shows an Explore card per target region and the form', async ({ assert }) => {
    const { status, html } = await get('/')

    assert.equal(status, 200)
    assert.equal(count(html, /class="explore-card"/g), 2)
    assert.include(html, 'Moon · South Pole')
    assert.include(html, 'Mars · Jezero')
    assert.match(html, /name="features\[\]"\s+value="slope_stddev_deg"/)
    assert.include(html, 'No discovery run yet')
  })

  test('a shared result URL renders the results and the chosen cell', async ({ assert }) => {
    const { status, html } = await get(`/?${CONFIG}&cell=moon_south_south_pole_r8_c4`)

    assert.equal(status, 200)
    assert.include(html, 'cell-detail__title mono">moon_south_south_pole_r8_c4')
    assert.equal(count(html, /<li class="candidate" /g), 4)
    assert.include(html.replace(/\s+/g, ' '), 'Features: Mean slope, Robust relief')
    assert.match(html, /<a class="cell is-selected"[^>]*data-cell="moon_south_south_pole_r8_c4"/)
  })

  test('an invalid shared URL shows the problems instead of failing', async ({ assert }) => {
    const { status, html } = await get('/?world=Venus')

    assert.equal(status, 200)
    assert.include(html, 'Choose the Moon or Mars as the target world.')
  })

  test('the discover partial renders the summary, grid, and best cell', async ({ assert }) => {
    const { status, html } = await get(`/partials/discover?${CONFIG}`)

    assert.equal(status, 200)
    assert.notInclude(html, '<html')
    assert.equal(count(html, /class="cell /g), 400, 'every target cell, eligible or not')
    assert.isAbove(count(html, /cell--excluded/g), 0)
    assert.equal(count(html, /class="cell is-selected"/g), 1)
    assert.include(html, 'lower = closer')
    assert.include(html, 'The Earth reference library covers the Atacama Desert only')
  })

  test('distances are never shown as percentages', async ({ assert }) => {
    const { html } = await get(`/partials/discover?${CONFIG}`)
    const distances = [...html.matchAll(/candidate__distance">\s*<span class="readout">([^<]+)</g)]

    assert.isAbove(distances.length, 0)
    for (const [, value] of distances) {
      assert.match(value.trim(), /^\d+\.\d{2}$/)
    }
  })

  test('invalid settings return a 422 notice', async ({ assert }) => {
    const { status, html } = await get(
      '/partials/discover?world=Moon&region=Jezero&reference=Atacama&topN=50'
    )

    assert.equal(status, 422)
    assert.include(html, 'Choose a target region on the selected world.')
    assert.include(html, 'Select at least one terrain feature.')
    assert.include(html, 'Choose between 1 and 25 candidates per target cell.')
  })

  test('the regions partial lists one world’s target regions', async ({ assert }) => {
    const mars = await get('/partials/regions?world=Mars')
    const unknown = await get('/partials/regions?world=Pluto')

    assert.equal(mars.status, 200)
    assert.include(mars.html, 'value="Jezero"')
    assert.notInclude(mars.html, 'South_Pole')
    assert.equal(unknown.status, 422)
  })

  test('the cell partial lists ranked candidates, or 404s for unknown cells', async ({
    assert,
  }) => {
    const found = await get(`/partials/cells/moon_south_south_pole_r8_c4?${CONFIG}`)
    const missing = await get(`/partials/cells/moon_south_south_pole_r999_c0?${CONFIG}`)

    assert.equal(found.status, 200)
    assert.equal(count(found.html, /<li class="candidate" /g), 4)
    assert.deepEqual(
      [...found.html.matchAll(/candidate__rank">#(\d+)/g)].map((match) => match[1]),
      ['1', '2', '3', '4']
    )
    assert.equal(count(found.html, /<li class="diff">/g), 8, 'two selected features per card')
    assert.equal(missing.status, 404)
  })

  test('home shows the Earth map with a marker per reference region', async ({ assert }) => {
    const { html } = await get('/')

    assert.match(
      html,
      /class="earth-map__img"\s+src="https:\/\/gibs\.earthdata\.nasa\.gov\/wms\/epsg4326\/best\/wms\.cgi\?[^"]*LAYERS=BlueMarble_NextGeneration[^"]*BBOX=-90%2C-180%2C90%2C180/
    )
    assert.equal(count(html, /class="region-marker"/g), 1)
    assert.include(html, 'region-marker__label">Atacama<')
    assert.equal(count(html, /class="graticule__meridian/g), 11)
    assert.equal(count(html, /class="graticule__parallel/g), 5)
  })

  test('candidates come with the reference-region inset and layer switcher', async ({ assert }) => {
    const { html } = await get(`/partials/cells/moon_south_south_pole_r8_c4?${CONFIG}`)

    const markers = [...html.matchAll(/<a\s+class="map-marker"\s+href="#candidate-(\d+)"/g)]
    assert.deepEqual(
      markers.map((match) => match[1]),
      ['1', '2', '3', '4']
    )
    for (const [, rank] of markers) {
      assert.include(html, `id="candidate-${rank}" data-rank="${rank}"`)
    }
    assert.include(html, 'Earth · Atacama')
    for (const layer of [
      'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
      'MODIS_Terra_L3_Land_Surface_Temp_8Day_Day',
      'ASTER_GDEM_Color_Shaded_Relief',
    ]) {
      assert.include(html, `LAYERS=${layer}`)
    }
    assert.equal(count(html, /class="chip"\s+data-layer=/g), 3)
    assert.include(html, 'Context only: the ranking uses terrain features alone.')
  })
})
