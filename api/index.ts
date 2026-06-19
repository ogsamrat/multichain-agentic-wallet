import { Hono } from 'hono'
import { createApp, getStore, runHealthChecks, seedStore } from '@prism/index'

// Vercel Edge Function: hosts the Prism Index registry API.
// Edge passes the request body natively to `app.fetch`, so body-reading POSTs
// (submit, feedback) work. The registry is edge-safe (no node: APIs; base64
// falls back to atob; the Postgres driver is Neon's fetch-based HTTP client).
// Routes (via vercel.json rewrites): /health, /v1/* -> this function.
export const config = { runtime: 'edge' }

// Lazily build the app once per warm instance. Uses a durable Postgres store
// when a connection string is configured (DATABASE_URL / POSTGRES_URL / ...),
// otherwise an in-memory store seeded with demo data.
let appPromise: Promise<Hono> | undefined

async function buildApp(): Promise<Hono> {
  const store = await getStore()
  if (await store.isEmpty()) await seedStore(store)
  const registry = createApp(store)
  const app = new Hono()
  app.get('/v1/cron', async (c) =>
    c.json({ ok: true, store: store.kind, ...(await runHealthChecks(store)) })
  )
  app.route('/', registry)
  return app
}

function getApp(): Promise<Hono> {
  appPromise ??= buildApp()
  return appPromise
}

export default async (req: Request): Promise<Response> => {
  const app = await getApp()
  return app.fetch(req)
}
