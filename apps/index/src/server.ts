/**
 * Node entrypoint (`npm start` / `npm run dev`).
 *
 * Builds the configured store (in-memory by default), seeds demo data when the
 * store is empty so the API has something to return in dev, mounts the Hono app
 * via `@hono/node-server`, and runs the health engine on a 60s interval so
 * listings are continuously re-verified.
 */
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { runHealthChecks } from './health.js'
import { seedStore } from './seed.js'
import { getStore } from './store/index.js'

async function main(): Promise<void> {
  const store = await getStore()

  // Dev convenience: seed demo listings into an empty store.
  if (await store.isEmpty()) {
    await seedStore(store)
  }

  const app = createApp(store)
  const port = Number.parseInt(process.env.PORT ?? '8787', 10)

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(
      `Prism Index listening on http://localhost:${info.port} (store: ${store.kind})`
    )
  })

  // Re-verify due listings on a fixed cadence. The health engine itself only
  // touches listings whose nextCheckAt is due, so a tight tick is cheap.
  const HEALTH_INTERVAL_MS = 60_000
  setInterval(() => {
    runHealthChecks(store).catch((err) => {
      console.error('health check pass failed:', err)
    })
  }, HEALTH_INTERVAL_MS)
}

main().catch((err) => {
  console.error('Prism Index failed to start:', err)
  process.exit(1)
})
