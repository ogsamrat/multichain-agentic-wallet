import { getRequestListener } from '@hono/node-server'
import { Hono } from 'hono'
import {
  MemoryStore,
  createApp,
  seedStore,
  runHealthChecks
} from '@prism/index'

// Vercel Node Function: hosts the Prism Index registry API.
// Routes (via vercel.json rewrites): /health, /v1/* -> this function.
export const config = { runtime: 'nodejs' }

// One store per warm instance. In-memory + seeded so the public API returns
// data with zero external services. Set DATABASE_URL in the Vercel project to
// switch the registry to a durable Postgres store (see apps/index/store).
const store = new MemoryStore()
const ready = seedStore(store)
const registry = createApp(store)

const app = new Hono()
app.use('*', async (_c, next) => {
  await ready
  await next()
})
app.get('/v1/cron', async (c) =>
  c.json({ ok: true, ...(await runHealthChecks(store)) })
)
app.route('/', registry)

export default getRequestListener(app.fetch)
