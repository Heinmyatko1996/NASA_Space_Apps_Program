/*
|--------------------------------------------------------------------------
| Package the app for Vercel (Build Output API v3)
|--------------------------------------------------------------------------
|
| Run from the app root after `npm ci`:
|
|   node deploy/vercel/build.mjs
|   npx vercel deploy --prebuilt --prod
|
| Vercel has no AdonisJS preset, so this script builds the app itself and
| writes .vercel/output/ by hand:
|
|   static/                The built public/ folder, served by Vercel's CDN
|                          (which also gzip/brotli-compresses responses).
|   functions/index.func/  The production build with its production
|                          node_modules (including DuckDB's native linux-x64
|                          binding) and deploy/vercel/handler.js, which
|                          boots AdonisJS once per instance.
|   config.json            Serve static files first, send everything else
|                          to the function.
|
| Build on linux-x64: npm installs only the DuckDB binding for the machine
| it runs on, and Vercel functions run on linux-x64.
|
| APP_KEY and APP_URL are not written here. They are Vercel project
| environment variables (Production), so the key never lands in a build.
|
*/

import { execSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)
const BUILD = new URL('build/', ROOT)
const OUTPUT = new URL('.vercel/output/', ROOT)
const FUNC = new URL('functions/index.func/', OUTPUT)

const NODE_RUNTIME = 'nodejs24.x'

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error(`Build on linux-x64 (this is ${process.platform}-${process.arch}): see the header`)
}

function run(command, cwd) {
  console.log(`$ ${command}`)
  execSync(command, { cwd, stdio: 'inherit' })
}

run('node ace build', ROOT)

// `npm ci --omit=dev` still installs devDependencies that a production
// package lists as an optional peer (npm marks them "devOptional"):
// TypeScript, Vite, the assembler, Playwright... ~140 MB, which pushes the
// function past Vercel's 250 MB limit. Dropping devDependencies from the
// build's package.json avoids that; the lockfile still pins every version.
const pkgUrl = new URL('package.json', BUILD)
const pkg = JSON.parse(await readFile(pkgUrl, 'utf8'))
delete pkg.devDependencies
await writeFile(pkgUrl, JSON.stringify(pkg, null, 2) + '\n')
await rm(new URL('node_modules/', BUILD), { recursive: true, force: true })
run('npm install --omit=dev --ignore-scripts --no-audit --no-fund', BUILD)

// npm installs DuckDB's musl binding next to the glibc one (~90 MB).
// Vercel's runtime is glibc, so only node-bindings-linux-x64 is loaded.
await rm(new URL('node_modules/@duckdb/node-bindings-linux-x64-musl/', BUILD), {
  recursive: true,
  force: true,
})

if (!existsSync(new URL('node_modules/@duckdb/node-bindings-linux-x64/duckdb.node', BUILD))) {
  throw new Error('DuckDB linux-x64 binding missing from build/node_modules')
}

await rm(OUTPUT, { recursive: true, force: true })
await mkdir(FUNC, { recursive: true })

await cp(new URL('public/', BUILD), new URL('static/', OUTPUT), { recursive: true })
await cp(BUILD, FUNC, { recursive: true })
await cp(new URL('deploy/vercel/handler.js', ROOT), new URL('handler.js', FUNC))

await writeFile(
  new URL('.vc-config.json', FUNC),
  JSON.stringify(
    {
      runtime: NODE_RUNTIME,
      handler: 'handler.js',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 30,
      environment: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3000',
        LOG_LEVEL: 'info',
        SESSION_DRIVER: 'cookie',
      },
    },
    null,
    2
  )
)

await writeFile(
  new URL('config.json', OUTPUT),
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          // Vite's hashed bundles never change under the same name.
          src: '^/assets/(.*)$',
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index' },
      ],
    },
    null,
    2
  )
)

console.log(`\nWrote ${OUTPUT.pathname}`)
