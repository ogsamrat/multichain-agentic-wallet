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
 * Default, dependency-free store. Everything lives in Maps/arrays so the app
 * runs locally with no Postgres. This is the canonical, fully-implemented
 * backend; `PostgresStore` mirrors it for production deployments.
 */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const

  private providers = new Map<string, Provider>()
  private listings = new Map<string, Listing>()
  /** slug -> listing id index for O(1) slug lookups. */
  private slugIndex = new Map<string, string>()
  /** listing id -> payment options. */
  private paymentOptions = new Map<string, PaymentOption[]>()
  /** listing id -> verification runs (newest last). */
  private verifications = new Map<string, VerificationRun[]>()
  /** listing id -> liveness signals (newest last). */
  private liveness = new Map<string, LivenessSignal[]>()

  async isEmpty(): Promise<boolean> {
    return this.listings.size === 0
  }

  // --- providers ---------------------------------------------------------
  async upsertProvider(provider: Provider): Promise<Provider> {
    this.providers.set(provider.id, provider)
    return provider
  }

  async getProvider(id: string): Promise<Provider | undefined> {
    return this.providers.get(id)
  }

  // --- listings ----------------------------------------------------------
  async createListing(listing: Listing): Promise<Listing> {
    this.listings.set(listing.id, listing)
    this.slugIndex.set(listing.slug, listing.id)
    return listing
  }

  async getListingBySlug(slug: string): Promise<Listing | undefined> {
    const id = this.slugIndex.get(slug)
    return id ? this.listings.get(id) : undefined
  }

  async getListingById(id: string): Promise<Listing | undefined> {
    return this.listings.get(id)
  }

  async searchListings(filter: ListingFilter): Promise<Listing[]> {
    let rows = [...this.listings.values()]

    // Visibility gate: by default only verified-working, healthy/degraded.
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

    // Keyword match on q (name/description/tags/slug). Also used to rank below.
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

    // Payment-derived filters (chain/asset/price) require joining options.
    const needsPaymentFilter =
      (filter.chains && filter.chains.length > 0) ||
      filter.asset !== undefined ||
      filter.maxPriceUsd !== undefined

    if (needsPaymentFilter) {
      rows = rows.filter((l) => {
        const opts = (this.paymentOptions.get(l.id) ?? []).filter(
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

    // Ranking: reliability first, nudged by a keyword relevance bonus on q.
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
    const existing = this.listings.get(id)
    if (!existing) return undefined
    const next: Listing = { ...existing, ...patch, id: existing.id }
    // Keep the slug index consistent if the slug ever changes.
    if (patch.slug && patch.slug !== existing.slug) {
      this.slugIndex.delete(existing.slug)
      this.slugIndex.set(patch.slug, id)
    }
    this.listings.set(id, next)
    return next
  }

  async updateListingHealth(
    listingId: string,
    patch: Partial<Listing>
  ): Promise<Listing | undefined> {
    // In-memory there is nothing to coordinate; reuse the generic update.
    return this.updateListing(listingId, patch)
  }

  async listDueForCheck(now: Date): Promise<Listing[]> {
    const cutoff = now.getTime()
    return [...this.listings.values()]
      .filter((l) => l.status !== 'paused' && l.status !== 'rejected')
      .filter((l) => new Date(l.nextCheckAt).getTime() <= cutoff)
      .sort(
        (a, b) =>
          new Date(a.nextCheckAt).getTime() - new Date(b.nextCheckAt).getTime()
      )
  }

  // --- payment options ---------------------------------------------------
  async upsertPaymentOptions(
    listingId: string,
    options: PaymentOption[]
  ): Promise<PaymentOption[]> {
    this.paymentOptions.set(listingId, options)
    return options
  }

  async getPaymentOptions(listingId: string): Promise<PaymentOption[]> {
    return this.paymentOptions.get(listingId) ?? []
  }

  // --- verification history ---------------------------------------------
  async recordVerificationRun(run: VerificationRun): Promise<VerificationRun> {
    const list = this.verifications.get(run.listingId) ?? []
    list.push(run)
    // Cap history so memory stays bounded.
    if (list.length > 500) list.splice(0, list.length - 500)
    this.verifications.set(run.listingId, list)
    return run
  }

  async recentVerifications(
    slug: string,
    limit = 50
  ): Promise<VerificationRun[]> {
    const id = this.slugIndex.get(slug)
    if (!id) return []
    return this.recentVerificationsById(id, limit)
  }

  async recentVerificationsById(
    listingId: string,
    limit = 50
  ): Promise<VerificationRun[]> {
    const list = this.verifications.get(listingId) ?? []
    return list.slice(-limit).reverse()
  }

  // --- liveness signals --------------------------------------------------
  async recordLivenessSignal(signal: LivenessSignal): Promise<LivenessSignal> {
    const list = this.liveness.get(signal.listingId) ?? []
    list.push(signal)
    if (list.length > 500) list.splice(0, list.length - 500)
    this.liveness.set(signal.listingId, list)
    return signal
  }

  async recentLiveness(
    listingId: string,
    limit = 100
  ): Promise<LivenessSignal[]> {
    const list = this.liveness.get(listingId) ?? []
    return list.slice(-limit).reverse()
  }

  // --- facets ------------------------------------------------------------
  async listCategories(): Promise<Category[]> {
    const counts = new Map<string, number>()
    for (const l of this.listings.values()) {
      if (!l.verifiedWorking) continue
      if (l.status !== 'healthy' && l.status !== 'degraded') continue
      for (const c of l.categories) {
        counts.set(c, (counts.get(c) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([slug, count]) => ({ slug, name: titleCase(slug), count }))
      .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
  }
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
}
