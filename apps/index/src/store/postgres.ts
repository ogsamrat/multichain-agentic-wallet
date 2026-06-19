import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type {
  Category,
  Listing,
  ListingFilter,
  LivenessSignal,
  PaymentOption,
  Provider,
  VerificationRun
} from '../types.js'
import type { Store } from './store.js'

/**
 * Durable, edge-compatible store backed by Neon's HTTP driver.
 *
 * Design: a document store. Each row keeps the full domain object in a `jsonb`
 * `doc` column plus a few promoted columns for keys/ordering. All queries are
 * static (no dynamic SQL building); richer filtering and ranking happen in JS,
 * mirroring {@link MemoryStore} exactly. That keeps this backend simple,
 * correct, and runnable on the Vercel Edge runtime (Neon HTTP uses `fetch`).
 */
export class PostgresStore implements Store {
  readonly kind = 'postgres' as const
  private readonly sql: NeonQueryFunction<false, false>

  private constructor(connectionString: string) {
    this.sql = neon(connectionString)
  }

  /** Connect and ensure the schema exists. */
  static async create(connectionString: string): Promise<PostgresStore> {
    const store = new PostgresStore(connectionString)
    await store.ensureSchema()
    return store
  }

  private async ensureSchema(): Promise<void> {
    const sql = this.sql
    await sql`CREATE TABLE IF NOT EXISTS providers (id text PRIMARY KEY, doc jsonb NOT NULL)`
    await sql`CREATE TABLE IF NOT EXISTS listings (
      id text PRIMARY KEY,
      slug text UNIQUE NOT NULL,
      verified boolean NOT NULL DEFAULT false,
      status text NOT NULL,
      next_check_at timestamptz,
      doc jsonb NOT NULL
    )`
    await sql`CREATE TABLE IF NOT EXISTS payment_options (
      id text PRIMARY KEY,
      listing_id text NOT NULL,
      doc jsonb NOT NULL
    )`
    await sql`CREATE INDEX IF NOT EXISTS payment_options_listing_idx ON payment_options (listing_id)`
    await sql`CREATE TABLE IF NOT EXISTS verification_runs (
      id text PRIMARY KEY,
      listing_id text NOT NULL,
      run_at timestamptz NOT NULL DEFAULT now(),
      doc jsonb NOT NULL
    )`
    await sql`CREATE INDEX IF NOT EXISTS verification_runs_listing_idx ON verification_runs (listing_id, run_at DESC)`
    await sql`CREATE TABLE IF NOT EXISTS liveness_signals (
      id text PRIMARY KEY,
      listing_id text NOT NULL,
      reported_at timestamptz NOT NULL DEFAULT now(),
      doc jsonb NOT NULL
    )`
    await sql`CREATE INDEX IF NOT EXISTS liveness_signals_listing_idx ON liveness_signals (listing_id, reported_at DESC)`
  }

  async isEmpty(): Promise<boolean> {
    const rows = (await this.sql`SELECT 1 FROM listings LIMIT 1`) as unknown[]
    return rows.length === 0
  }

  // --- providers ---------------------------------------------------------
  async upsertProvider(provider: Provider): Promise<Provider> {
    await this
      .sql`INSERT INTO providers (id, doc) VALUES (${provider.id}, ${JSON.stringify(provider)}::jsonb)
           ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`
    return provider
  }

  async getProvider(id: string): Promise<Provider | undefined> {
    const rows = (await this
      .sql`SELECT doc FROM providers WHERE id = ${id}`) as {
      doc: Provider
    }[]
    return rows[0]?.doc
  }

  // --- listings ----------------------------------------------------------
  async createListing(listing: Listing): Promise<Listing> {
    await this.writeListing(listing)
    return listing
  }

  private async writeListing(listing: Listing): Promise<void> {
    await this
      .sql`INSERT INTO listings (id, slug, verified, status, next_check_at, doc)
           VALUES (${listing.id}, ${listing.slug}, ${listing.verifiedWorking}, ${listing.status}, ${listing.nextCheckAt}, ${JSON.stringify(listing)}::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             slug = EXCLUDED.slug,
             verified = EXCLUDED.verified,
             status = EXCLUDED.status,
             next_check_at = EXCLUDED.next_check_at,
             doc = EXCLUDED.doc`
  }

  async getListingBySlug(slug: string): Promise<Listing | undefined> {
    const rows = (await this
      .sql`SELECT doc FROM listings WHERE slug = ${slug}`) as { doc: Listing }[]
    return rows[0]?.doc
  }

  async getListingById(id: string): Promise<Listing | undefined> {
    const rows = (await this
      .sql`SELECT doc FROM listings WHERE id = ${id}`) as {
      doc: Listing
    }[]
    return rows[0]?.doc
  }

  private async allListings(): Promise<Listing[]> {
    const rows = (await this.sql`SELECT doc FROM listings`) as {
      doc: Listing
    }[]
    return rows.map((r) => r.doc)
  }

  async searchListings(filter: ListingFilter): Promise<Listing[]> {
    let rows = await this.allListings()

    if (!filter.includeUnverified) {
      rows = rows.filter((l) => l.verifiedWorking)
      const allowed = new Set<Listing['status']>(
        filter.includeDegraded ? ['healthy', 'degraded'] : ['healthy']
      )
      rows = rows.filter((l) => allowed.has(l.status))
    } else if (filter.statuses && filter.statuses.length > 0) {
      const allowed = new Set(filter.statuses)
      rows = rows.filter((l) => allowed.has(l.status))
    }

    if (filter.type) rows = rows.filter((l) => l.type === filter.type)

    if (filter.category) {
      const cat = filter.category.toLowerCase()
      rows = rows.filter((l) =>
        l.categories.some((c) => c.toLowerCase() === cat)
      )
    }

    if (filter.q) {
      const q = filter.q.toLowerCase()
      rows = rows.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q) ||
          l.tags.some((t) => t.toLowerCase().includes(q)) ||
          l.slug.toLowerCase().includes(q)
      )
    }

    if (filter.minUptime !== undefined) {
      const min = filter.minUptime
      rows = rows.filter((l) => (l.uptime30d ?? 0) >= min)
    }
    if (filter.minScore !== undefined) {
      const min = filter.minScore
      rows = rows.filter((l) => l.reliabilityScore >= min)
    }

    const needsPaymentFilter =
      (filter.chains && filter.chains.length > 0) ||
      filter.asset !== undefined ||
      filter.maxPriceUsd !== undefined

    if (needsPaymentFilter && rows.length > 0) {
      const optionsByListing = await this.allPaymentOptions()
      rows = rows.filter((l) => {
        const opts = (optionsByListing.get(l.id) ?? []).filter(
          (o) => o.isActive
        )
        if (opts.length === 0) return false
        return opts.some((o) => {
          if (filter.chains && filter.chains.length > 0) {
            if (!filter.chains.includes(o.networkCaip2)) return false
          }
          if (filter.asset !== undefined) {
            const a = filter.asset.toLowerCase()
            if (
              o.asset.toLowerCase() !== a &&
              o.assetSymbol.toLowerCase() !== a
            ) {
              return false
            }
          }
          if (filter.maxPriceUsd !== undefined) {
            if (o.priceUsd === undefined) return false
            if (o.priceUsd > filter.maxPriceUsd) return false
          }
          return true
        })
      })
    }

    const q = filter.q?.toLowerCase()
    const score = (l: Listing): number => {
      let s = l.reliabilityScore
      if (q) {
        if (l.name.toLowerCase().includes(q)) s += 25
        if (l.slug.toLowerCase().includes(q)) s += 15
        if (l.tags.some((t) => t.toLowerCase() === q)) s += 10
      }
      return s
    }
    rows.sort(
      (a, b) =>
        score(b) - score(a) ||
        b.reliabilityScore - a.reliabilityScore ||
        a.slug.localeCompare(b.slug)
    )

    const offset = filter.offset ?? 0
    const limit = filter.limit ?? rows.length
    return rows.slice(offset, offset + limit)
  }

  async updateListing(
    id: string,
    patch: Partial<Listing>
  ): Promise<Listing | undefined> {
    const existing = await this.getListingById(id)
    if (!existing) return undefined
    const next: Listing = { ...existing, ...patch, id: existing.id }
    await this.writeListing(next)
    return next
  }

  async updateListingHealth(
    listingId: string,
    patch: Partial<Listing>
  ): Promise<Listing | undefined> {
    return this.updateListing(listingId, patch)
  }

  async listDueForCheck(now: Date): Promise<Listing[]> {
    const cutoff = now.getTime()
    return (await this.allListings())
      .filter((l) => l.status !== 'paused' && l.status !== 'rejected')
      .filter((l) => new Date(l.nextCheckAt).getTime() <= cutoff)
      .sort(
        (a, b) =>
          new Date(a.nextCheckAt).getTime() - new Date(b.nextCheckAt).getTime()
      )
  }

  // --- payment options ---------------------------------------------------
  private async allPaymentOptions(): Promise<Map<string, PaymentOption[]>> {
    const rows = (await this
      .sql`SELECT listing_id, doc FROM payment_options`) as {
      listing_id: string
      doc: PaymentOption
    }[]
    const map = new Map<string, PaymentOption[]>()
    for (const r of rows) {
      const list = map.get(r.listing_id) ?? []
      list.push(r.doc)
      map.set(r.listing_id, list)
    }
    return map
  }

  async upsertPaymentOptions(
    listingId: string,
    options: PaymentOption[]
  ): Promise<PaymentOption[]> {
    await this.sql`DELETE FROM payment_options WHERE listing_id = ${listingId}`
    for (const o of options) {
      await this
        .sql`INSERT INTO payment_options (id, listing_id, doc) VALUES (${genId('po')}, ${listingId}, ${JSON.stringify(o)}::jsonb)`
    }
    return options
  }

  async getPaymentOptions(listingId: string): Promise<PaymentOption[]> {
    const rows = (await this
      .sql`SELECT doc FROM payment_options WHERE listing_id = ${listingId}`) as {
      doc: PaymentOption
    }[]
    return rows.map((r) => r.doc)
  }

  // --- verification history ---------------------------------------------
  async recordVerificationRun(run: VerificationRun): Promise<VerificationRun> {
    await this
      .sql`INSERT INTO verification_runs (id, listing_id, run_at, doc) VALUES (${run.id}, ${run.listingId}, ${run.runAt}, ${JSON.stringify(run)}::jsonb)`
    return run
  }

  async recentVerifications(
    slug: string,
    limit = 50
  ): Promise<VerificationRun[]> {
    const listing = await this.getListingBySlug(slug)
    if (!listing) return []
    return this.recentVerificationsById(listing.id, limit)
  }

  async recentVerificationsById(
    listingId: string,
    limit = 50
  ): Promise<VerificationRun[]> {
    const rows = (await this
      .sql`SELECT doc FROM verification_runs WHERE listing_id = ${listingId} ORDER BY run_at DESC LIMIT ${limit}`) as {
      doc: VerificationRun
    }[]
    return rows.map((r) => r.doc)
  }

  // --- liveness signals --------------------------------------------------
  async recordLivenessSignal(signal: LivenessSignal): Promise<LivenessSignal> {
    await this
      .sql`INSERT INTO liveness_signals (id, listing_id, reported_at, doc) VALUES (${signal.id}, ${signal.listingId}, ${signal.reportedAt}, ${JSON.stringify(signal)}::jsonb)`
    return signal
  }

  async recentLiveness(
    listingId: string,
    limit = 100
  ): Promise<LivenessSignal[]> {
    const rows = (await this
      .sql`SELECT doc FROM liveness_signals WHERE listing_id = ${listingId} ORDER BY reported_at DESC LIMIT ${limit}`) as {
      doc: LivenessSignal
    }[]
    return rows.map((r) => r.doc)
  }

  // --- facets ------------------------------------------------------------
  async listCategories(): Promise<Category[]> {
    const counts = new Map<string, number>()
    for (const l of await this.allListings()) {
      if (!l.verifiedWorking) continue
      if (l.status !== 'healthy' && l.status !== 'degraded') continue
      for (const c of l.categories) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([slug, count]) => ({ slug, name: titleCase(slug), count }))
      .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
  }
}

function genId(prefix = 'id'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
}
