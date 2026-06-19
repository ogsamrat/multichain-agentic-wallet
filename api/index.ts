import { Hono } from 'hono'
import {
  MemoryStore,
  createApp,
  seedStore,
  runHealthChecks
} from '@prism/index'

// Vercel Edge Function: hosts the Prism Index registry API.
// Edge passes the request body natively to `app.fetch`, so body-reading POSTs
// (submit, feedback) work — the Node adapter stalled on them. The registry is
// edge-safe (no node: APIs; base64 falls back to atob).
// Routes (via vercel.json rewrites): /health, /v1/* -> this function.
export const config = { runtime: 'edge' }

// One store per warm instance. In-memory + seeded so the public API returns
// data with zero external services. Set DATABASE_URL to use a durable store.
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

export default (req: Request): Response | Promise<Response> => app.fetch(req)
