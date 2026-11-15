import Alpine from 'alpinejs'

Alpine.data('alert', function () {
  return {
    isVisible: false,
    dismiss() {
      this.isVisible = false
    },
    init() {
      setTimeout(() => {
        this.isVisible = true
      }, 80)
      setTimeout(() => {
        this.dismiss()
      }, 5000)
    },
  }
})

Alpine.data('themeToggle', function () {
  return {
    theme: 'light',
    init() {
      this.theme = this.$el.dataset.initialTheme || 'light'
    },
    toggle() {
      const next = this.theme === 'dark' ? 'light' : 'dark'
      this.theme = next
      document.documentElement.setAttribute('data-theme', next)
      document.cookie = `app_theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    },
  }
})

/*
|--------------------------------------------------------------------------
| Partial swaps
|--------------------------------------------------------------------------
|
| $swap(url, target) fetches an Edge partial and replaces the target's
| content. Alpine's mutation observer initializes any Alpine markup in the
| new HTML. Error responses (422, 404) are swapped in too: the server renders
| them as readable notices. If a newer swap of the same target starts first,
| the older response is dropped, so fast clicks can't show stale results.
|
| $store.ui.loading is true while any swap is in flight.
*/

Alpine.store('ui', { loading: false, pending: 0 })

let swapToken = 0

Alpine.magic('swap', () => async (url, target) => {
  const element = typeof target === 'string' ? document.querySelector(target) : target
  if (!element) {
    return null
  }

  const token = String(++swapToken)
  const ui = Alpine.store('ui')
  element.dataset.swapToken = token
  element.setAttribute('aria-busy', 'true')
  ui.pending += 1
  ui.loading = true

  try {
    const response = await fetch(url, { headers: { Accept: 'text/html' } })
    const html = await response.text()
    if (element.dataset.swapToken === token) {
      element.innerHTML = html
    }
    return response
  } catch {
    if (element.dataset.swapToken === token) {
      element.innerHTML =
        '<div class="notice notice--error" role="alert">Could not reach the server. Check your connection and try again.</div>'
    }
    return null
  } finally {
    if (element.dataset.swapToken === token) {
      element.removeAttribute('aria-busy')
    }
    ui.pending -= 1
    ui.loading = ui.pending > 0
  }
})

/*
|--------------------------------------------------------------------------
| Discovery page
|--------------------------------------------------------------------------
|
| The form works without JavaScript (GET / with the configuration in the
| query string). With JavaScript, submitting swaps only the results and puts
| the same query string in the address bar so the result can be shared.
*/

Alpine.data('discovery', function () {
  return {
    submit() {
      const query = new URLSearchParams(new FormData(this.$refs.form)).toString()
      this.$swap(`/partials/discover?${query}`, '#results')
      history.replaceState(null, '', `/?${query}`)
    },

    async changeWorld(world) {
      await this.$swap(`/partials/regions?world=${encodeURIComponent(world)}`, '#region-selector')
    },

    applyPreset(features) {
      for (const box of this.$refs.form.querySelectorAll('input[name="features[]"]')) {
        box.checked = features.includes(box.value)
      }
      this.$refs.form.requestSubmit()
    },

    /** "Use this setup" on an Explore card: its region, all features, Atacama. */
    async useSetup(world, region, reference) {
      const form = this.$refs.form
      const worldInput = form.querySelector(`input[name="world"][value="${CSS.escape(world)}"]`)
      if (worldInput && !worldInput.checked) {
        worldInput.checked = true
        await this.changeWorld(world)
      }
      const regionInput = form.querySelector(`input[name="region"][value="${CSS.escape(region)}"]`)
      if (regionInput) {
        regionInput.checked = true
      }
      const referenceSelect = form.querySelector('select[name="reference"]')
      if (referenceSelect && [...referenceSelect.options].some((o) => o.value === reference)) {
        referenceSelect.value = reference
      }
      for (const box of form.querySelectorAll('input[name="features[]"]')) {
        box.checked = true
      }
      form.requestSubmit()
      document.querySelector('#results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  }
})

/*
| Target cell grid: one delegated listener for every cell and table row.
| Selecting a cell swaps its candidates in and updates the address bar.
| The tooltip text is set with x-text (textContent), never as HTML.
*/
Alpine.data('cellGrid', function () {
  return {
    tip: { visible: false, value: '', title: '', detail: '', x: 0, y: 0 },

    select(event) {
      const link = event.target.closest('a[data-cell]')
      if (!link) {
        return
      }
      event.preventDefault()
      const cellId = link.dataset.cell
      for (const cell of this.$root.querySelectorAll('.cell.is-selected')) {
        cell.classList.remove('is-selected')
        cell.removeAttribute('aria-current')
      }
      for (const cell of this.$root.querySelectorAll(`.cell[data-cell="${CSS.escape(cellId)}"]`)) {
        cell.classList.add('is-selected')
        cell.setAttribute('aria-current', 'true')
      }
      const query = this.$root.dataset.query
      this.$swap(`/partials/cells/${encodeURIComponent(cellId)}?${query}`, '#cell-candidates')
      history.replaceState(null, '', link.getAttribute('href'))
      if (window.matchMedia('(max-width: 1180px)').matches) {
        document.querySelector('#cell-candidates')?.scrollIntoView({ behavior: 'smooth' })
      }
    },

    show(event) {
      const cell = event.target.closest('.cell')
      if (!cell) {
        return
      }
      const wrap = this.$refs.wrap.getBoundingClientRect()
      const box = cell.getBoundingClientRect()
      this.tip = {
        visible: true,
        value: cell.dataset.value,
        title: cell.dataset.cell,
        detail: cell.dataset.detail,
        x: box.left - wrap.left + box.width / 2,
        y: box.top - wrap.top,
      }
    },

    hide() {
      this.tip.visible = false
    },
  }
})

/*
| Reference-region inset (partials/analog_map.edge) and its candidate cards.
| Selecting a numbered marker or a card highlights both; a marker also
| scrolls its card into view. Markers are links to #candidate-N, so this
| only enhances the no-JavaScript behavior.
|
| $store.map.layer is the GIBS context layer. It lives in a store so the
| choice survives swapping in another cell's candidates. The image URLs are
| built on the server and read from the figure's data-layers attribute.
*/
Alpine.store('map', { layer: 'trueColor' })

Alpine.data('analogMap', function () {
  let layers = null

  return {
    layerSrc(id) {
      if (layers === null) {
        try {
          layers = JSON.parse(this.$root.querySelector('[data-layers]')?.dataset.layers ?? '[]')
        } catch {
          layers = []
        }
      }
      const layer = layers.find((entry) => entry.id === id) ?? layers[0]
      return layer?.src ?? ''
    },

    pick(event) {
      const item = event.target.closest('[data-rank]')
      if (!item || !this.$root.contains(item)) {
        return
      }
      const rank = item.dataset.rank
      for (const element of this.$root.querySelectorAll('[data-rank]')) {
        element.classList.toggle('is-active', element.dataset.rank === rank)
      }
      if (item.classList.contains('map-marker')) {
        event.preventDefault()
        this.$root
          .querySelector(`.candidate[data-rank="${CSS.escape(rank)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    },
  }
})

Alpine.start()
