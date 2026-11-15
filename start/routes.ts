/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

router.get('/', [controllers.Analogs, 'home']).as('home')

/**
 * HTML fragments swapped into the page by Alpine's $swap helper
 * (resources/js/app.js). All read-only GETs, so no CSRF token is needed.
 */
router.get('/partials/regions', [controllers.Analogs, 'regions']).as('partials.regions')
router.get('/partials/discover', [controllers.Analogs, 'discover']).as('partials.discover')
router.get('/partials/cells/:cellId', [controllers.Analogs, 'cell']).as('partials.cell')
