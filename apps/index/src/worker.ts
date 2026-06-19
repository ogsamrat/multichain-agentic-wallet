/**
 * Cloudflare-Worker-style entrypoint (edge / serverless cron deployment).
 *
 * This makes the edge shape explicit: `fetch` delegates to the Hono app, and
 * `scheduled` runs the health engine on the cron defined in `wrangler.toml`.
 * It deliberately uses a module-level store so the same instance is reused
 * across requests within a warm isolate. It does not need to run under Node —
 * `server.ts` is the Node entrypoint.
 */
import { createApp } from './app.js'
import { runHealthChecks } from './health.js'
import { seedStore } from './seed.js'
import { getStore } from './store/index.js'
import type { Store } from './store/store.js'

/** Minimal Worker runtime shapes (avoids a hard dep on @cloudflare/workers-types). */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException?(): void
}
interface ScheduledEvent {
  scheduledTime: number
  cron: string
}
type Env = Record<string, string | undefined>

// Module-level store, lazily initialized once per isolate.
let storePromise: Promise<Store> | undefined

async function getSharedStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = (async () => {
      const store = await getStore()
      if (await store.isEmpty()) await seedStore(store)
      return store
    })()
  }
  return storePromise
}

export default {
  async fetch(
    req: Request,
    _env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const store = await getSharedStore()
    const app = createApp(store)
    return app.fetch(req)
  },

  async scheduled(
    _event: ScheduledEvent,
    _env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const store = await getSharedStore()
    ctx.waitUntil(runHealthChecks(store, { checkKind: 'scheduled' }))
  }
}
