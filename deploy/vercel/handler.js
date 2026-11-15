/*
|--------------------------------------------------------------------------
| Vercel function entrypoint
|--------------------------------------------------------------------------
|
| Vercel runs this file instead of bin/server.js. It sits at the root of
| the production build (next to package.json), boots the AdonisJS app the
| same way the Ignitor's HTTP server process does, but without listening on
| a port: Vercel calls the default export with Node's req/res instead.
|
| The app (providers, DuckDB macros, data checks) boots once per function
| instance, on its first request, and later requests reuse it.
|
*/

import 'reflect-metadata'
import { fileURLToPath } from 'node:url'
import { Ignitor, prettyPrintError } from '@adonisjs/core/ignitor'

const APP_ROOT = new URL('./', import.meta.url)

// config/vite.ts names the manifest relative to the working directory, as
// `node bin/server.js` run from the build folder expects.
process.chdir(fileURLToPath(APP_ROOT))

const IMPORTER = (filePath) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href)
  }
  return import(filePath)
}

async function boot() {
  const ignitor = new Ignitor(APP_ROOT, { importer: IMPORTER }).tap((app) => {
    app.booting(async () => {
      await import('#start/env')
    })
  })

  const app = ignitor.createApp('web')
  await app.init()
  await app.boot()

  let handle
  await app.start(async () => {
    const server = await app.container.make('server')
    await server.boot()
    handle = server.handle.bind(server)
  })
  return handle
}

let booting

export default async function handler(req, res) {
  booting ??= boot().catch((error) => {
    // Let the next request retry the boot instead of caching the failure.
    booting = undefined
    prettyPrintError(error)
    throw error
  })
  const handle = await booting
  return handle(req, res)
}
