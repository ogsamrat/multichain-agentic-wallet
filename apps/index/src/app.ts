/**
 * The Prism Index HTTP API (Hono).
 *
 * Runtime-agnostic: the same app object serves Node (via `@hono/node-server`)
 * and edge/serverless (its `fetch` handler is a standard `Request => Response`).
 * Every route lives under `/v1` except the bare `/health` liveness probe.
 */
import { Hono } from 'hono'
import { runHealthChecks } from './health.js'
import { uptime30d } from './scoring.js'
import type { Store } from './store/store.js'
import { SubmissionRejected, submitListing } from './submit.js'
import type {
  Listing,
  ListingFilter,
  PaymentOption,
  ServiceType
} from './types.js'

function genId(prefix = 'id'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

const SERVICE_TYPES = new Set<ServiceType>([
  'x402_http_api',
  'mcp_server',
  'model_endpoint',
  'dataset',
  'compute',
  'storage',
  'rpc_infra',
  'agent_service'
])

/** Parses a query int, returning undefined when absent/invalid. */
function intParam(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

/** Parses a query float, returning undefined when absent/invalid. */
function floatParam(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

function truthy(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes'
}

/** Shapes a listing + its active payment options into the search result row. */
function toSearchRow(
  listing: Listing,
  options: PaymentOption[]
): Record<string, unknown> {
  const active = options.filter((o) => o.isActive)
  return {
    slug: listing.slug,
    type: listing.type,
    name: listing.name,
    description: listing.description,
    verifiedWorking: listing.verifiedWorking,
    reliabilityScore: listing.reliabilityScore,
    uptime30d: listing.uptime30d,
    latencyMs: { p50: listing.p50LatencyMs, p95: listing.p95LatencyMs },
    paymentOptions: active.map((o) => ({
      network: o.networkCaip2,
      asset: o.assetSymbol || o.asset,
      priceUsd: o.priceUsd,
      payTo: o.payTo
    })),
    inputSchema: listing.inputSchema,
    outputSchema: listing.outputSchema,
    callHint: listing.callHint
  }
}

/**
 * Builds the Hono app over a given store. Keeping the store injected (rather
 * than constructed inside) lets Node, the edge worker, and tests share routing.
 */
export function createApp(store: Store): Hono {
  const app = new Hono()

  // Liveness probe (outside /v1 on purpose).
  app.get('/health', (c) => c.json({ ok: true }))

  // --- search ----------------------------------------------------------
  app.get('/v1/search', async (c) => {
    const q = c.req.query('q')
    const typeRaw = c.req.query('type')
    const type =
      typeRaw && SERVICE_TYPES.has(typeRaw as ServiceType)
        ? (typeRaw as ServiceType)
        : undefined
    const chains = c.req.queries('chain')
    const filter: ListingFilter = {
      q,
      type,
      category: c.req.query('category'),
      chains: chains && chains.length > 0 ? chains : undefined,
      asset: c.req.query('asset'),
      maxPriceUsd: floatParam(c.req.query('max_price_usd')),
      minUptime: floatParam(c.req.query('min_uptime')),
      minScore: floatParam(c.req.query('min_score')),
      includeDegraded: truthy(c.req.query('include_degraded')),
      limit: intParam(c.req.query('limit')) ?? 50
    }

    const listings = await store.searchListings(filter)
    const results = await Promise.all(
      listings.map(async (l) => {
        const options = await store.getPaymentOptions(l.id)
        return toSearchRow(l, options)
      })
    )

    return c.json({ query: filter, count: results.length, results })
  })

  // --- categories ------------------------------------------------------
  app.get('/v1/categories', async (c) => {
    const categories = await store.listCategories()
    return c.json({ count: categories.length, categories })
  })

  // --- listing detail --------------------------------------------------
  app.get('/v1/listings/:slug', async (c) => {
    const listing = await store.getListingBySlug(c.req.param('slug'))
    if (!listing) return c.json({ error: 'not_found' }, 404)
    const paymentOptions = await store.getPaymentOptions(listing.id)
    return c.json({ listing, paymentOptions })
  })

  // --- listing health --------------------------------------------------
  app.get('/v1/listings/:slug/health', async (c) => {
    const slug = c.req.param('slug')
    const listing = await store.getListingBySlug(slug)
    if (!listing) return c.json({ error: 'not_found' }, 404)
    const runs = await store.recentVerifications(slug, 50)
    return c.json({
      slug,
      status: listing.status,
      verifiedWorking: listing.verifiedWorking,
      reliabilityScore: listing.reliabilityScore,
      uptime30d: uptime30d(runs) ?? listing.uptime30d,
      latencyMs: { p50: listing.p50LatencyMs, p95: listing.p95LatencyMs },
      lastVerifiedAt: listing.lastVerifiedAt,
      nextCheckAt: listing.nextCheckAt,
      consecutivePass: listing.consecutivePass,
      consecutiveFails: listing.consecutiveFails,
      recentRuns: runs
    })
  })

  // --- submit ----------------------------------------------------------
  app.post('/v1/listings', async (c) => {
    const required = process.env.PRISM_SUBMIT_KEY
    if (required) {
      const provided = c.req.header('x-prism-submit-key')
      if (provided !== required) return c.json({ error: 'unauthorized' }, 401)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }

    try {
      const listing = await submitListing(store, body)
      return c.json(
        { ok: true, slug: listing.slug, status: listing.status, listing },
        201
      )
    } catch (err) {
      if (err instanceof SubmissionRejected) {
        const status = err.reason === 'invalid' ? 400 : 422
        return c.json(
          { error: err.reason, message: err.message, detail: err.detail },
          status
        )
      }
      return c.json({ error: 'internal_error', message: String(err) }, 500)
    }
  })

  // --- feedback (liveness from paying agents) --------------------------
  app.post('/v1/feedback', async (c) => {
    let body: {
      slug?: string
      network?: string
      settled?: boolean
      latencyMs?: number
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }
    if (!body.slug) return c.json({ error: 'slug_required' }, 400)

    const listing = await store.getListingBySlug(body.slug)
    if (!listing) return c.json({ error: 'not_found' }, 404)

    const now = new Date().toISOString()
    await store.recordLivenessSignal({
      id: genId('ls'),
      listingId: listing.id,
      network: body.network ?? 'unknown',
      settled: Boolean(body.settled),
      latencyMs: body.latencyMs,
      reportedAt: now
    })

    // A real, settled payment is strong proof of life: clear the fail streak.
    if (body.settled) {
      await store.updateListing(listing.id, {
        consecutiveFails: 0,
        lastVerifiedAt: now,
        updatedAt: now
      })
    }

    return c.json({ ok: true })
  })

  // --- admin: trigger a health pass ------------------------------------
  app.post('/v1/admin/run-checks', async (c) => {
    const required = process.env.PRISM_ADMIN_KEY
    if (required) {
      const provided = c.req.header('x-prism-admin-key')
      if (provided !== required) return c.json({ error: 'unauthorized' }, 401)
    }
    const summary = await runHealthChecks(store, { checkKind: 'manual' })
    return c.json({ ok: true, ...summary })
  })

  return app
}
