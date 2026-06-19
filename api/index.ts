import { Hono } from 'hono'
import {
  MemoryStore,
  createApp,
  seedStore,
  runHealthChecks
} from '@prism/index'

// Vercel Edge Function: hosts the Prism Index registry API.
// Routes (via vercel.json rewrites): /health, /v1/* -> this function.
export const config = { runtime: 'edge' }

// One store per warm instance. In-memory + seeded so the public API returns
// data with zero external services. Set DATABASE_URL in the Vercel project to
// switch the registry to a durable Postgres store (see apps/index/store).
const store = new MemoryStore()
const ready = seedStore(store)
const registry = createApp(store)

const app = new Hono()

// Make sure seeding has completed before any request is served.
app.use('*', async (_c, next) => {
  await ready
  await next()
})

// Scheduled re-verification entrypoint (wired via vercel.json crons).
app.get('/v1/cron', async (c) => {
  const summary = await runHealthChecks(store)
  return c.json({ ok: true, ...summary })
})

app.route('/', registry)

export default (req: Request): Response | Promise<Response> => app.fetch(req)
