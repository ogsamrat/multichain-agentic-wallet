/**
 * Client for the Prism Index — the verified registry of agent-payable services.
 * The wallet queries it for live, payable services and reports back payment
 * outcomes so real usage feeds the Index's liveness signal.
 */

export interface DiscoverQuery {
  q?: string
  type?: string
  category?: string
  chains?: string[]
  asset?: string
  maxPriceUsd?: number
  minUptime?: number
  limit?: number
}

export interface DiscoveredService {
  slug: string
  type: string
  name: string
  description: string
  verifiedWorking: boolean
  reliabilityScore?: number
  uptime30d?: number
  paymentOptions?: Array<{
    network: string
    asset: string
    priceUsd: number
    payTo: string
  }>
  callHint?: Record<string, unknown>
  [key: string]: unknown
}

export class IndexClient {
  constructor(private readonly baseUrl?: string) {}

  get configured(): boolean {
    return Boolean(this.baseUrl)
  }

  async search(query: DiscoverQuery): Promise<DiscoveredService[]> {
    if (!this.baseUrl) return []
    const params = new URLSearchParams()
    if (query.q) params.set('q', query.q)
    if (query.type) params.set('type', query.type)
    if (query.category) params.set('category', query.category)
    if (query.asset) params.set('asset', query.asset)
    if (query.maxPriceUsd !== undefined)
      params.set('max_price_usd', String(query.maxPriceUsd))
    if (query.minUptime !== undefined)
      params.set('min_uptime', String(query.minUptime))
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    for (const chain of query.chains ?? []) params.append('chain', chain)

    const res = await fetch(
      `${this.baseUrl.replace(/\/$/, '')}/v1/search?${params}`,
      {
        headers: { Accept: 'application/json' }
      }
    )
    if (!res.ok) {
      throw new Error(`Prism Index returned ${res.status}`)
    }
    const data = (await res.json()) as { results?: DiscoveredService[] }
    return data.results ?? []
  }

  async getService(slug: string): Promise<DiscoveredService | null> {
    if (!this.baseUrl) return null
    const res = await fetch(
      `${this.baseUrl.replace(/\/$/, '')}/v1/listings/${slug}`,
      {
        headers: { Accept: 'application/json' }
      }
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Prism Index returned ${res.status}`)
    return (await res.json()) as DiscoveredService
  }

  /** Report a payment outcome back to the Index (fire-and-forget). */
  async reportLiveness(signal: {
    slug: string
    network: string
    settled: boolean
    latencyMs?: number
  }): Promise<void> {
    if (!this.baseUrl) return
    try {
      await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signal)
      })
    } catch {
      // liveness reporting is best-effort
    }
  }
}
