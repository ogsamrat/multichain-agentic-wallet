/**
 * Demo seed data so a fresh local instance is browsable immediately.
 *
 * These listings are inserted already `healthy` + `verifiedWorking` so
 * `/v1/search` returns data out of the box in development. In production the
 * health engine is the only thing that should ever set `verifiedWorking` — the
 * registry never trusts unverified data except this explicit dev convenience.
 */
import type { Listing, PaymentOption, Provider } from './types.js'
import type { Store } from './store/store.js'

function genId(prefix = 'id'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/** Inserts a handful of demo listings if the store is empty. */
export async function seedStore(store: Store): Promise<void> {
  if (!(await store.isEmpty())) return

  const now = new Date()
  const nowIso = now.toISOString()
  // Schedule the first real check a little ahead so seeds stay visible at boot.
  const nextCheck = new Date(now.getTime() + 5 * 60_000).toISOString()

  const provider: Provider = {
    id: genId('prov'),
    handle: 'prism-demo',
    displayName: 'Prism Demo Provider',
    trustTier: 'community',
    createdAt: nowIso
  }
  await store.upsertProvider(provider)

  const healthy = (over: Partial<Listing>): Listing => ({
    id: genId('lst'),
    slug: 'placeholder',
    providerId: provider.id,
    type: 'x402_http_api',
    name: '',
    description: '',
    endpointUrl: '',
    httpMethod: 'POST',
    origin: '',
    status: 'healthy',
    verifiedWorking: true,
    lastVerifiedAt: nowIso,
    nextCheckAt: nextCheck,
    checkIntervalS: 300,
    consecutiveFails: 0,
    consecutivePass: 3,
    reliabilityScore: 96,
    uptime30d: 0.999,
    p50LatencyMs: 120,
    p95LatencyMs: 340,
    categories: [],
    tags: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    ...over
  })

  // 1) x402 HTTP API on Base Sepolia, priced at 0.01 USDC, with a call hint.
  const insightUrl = 'http://localhost:4021/api/insight'
  const insight = healthy({
    slug: 'demo-insight-api',
    type: 'x402_http_api',
    name: 'Insight API',
    description:
      'Pay-per-call market insight endpoint. Returns a JSON insight for a query, gated behind an x402 402 handshake.',
    endpointUrl: insightUrl,
    origin: originOf(insightUrl),
    categories: ['data', 'analytics'],
    tags: ['x402', 'insight', 'usdc', 'base-sepolia'],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    },
    outputSchema: {
      type: 'object',
      properties: {
        insight: { type: 'string' },
        confidence: { type: 'number' }
      }
    },
    inputExample: { query: 'BTC 7d momentum' },
    outputExample: { insight: 'Momentum positive', confidence: 0.72 },
    callHint: {
      method: 'POST',
      url: insightUrl,
      contentType: 'application/json',
      pay_with: 'x402_fetch',
      notes:
        'Use an x402-capable fetch; the 402 advertises USDC on Base Sepolia.'
    }
  })
  await store.createListing(insight)
  const insightOption: PaymentOption = {
    listingId: insight.id,
    scheme: 'exact',
    networkCaip2: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    assetSymbol: 'USDC',
    assetDecimals: 6,
    payTo: '0x000000000000000000000000000000000000dEaD',
    amountAtomic: '10000', // 0.01 USDC (6 decimals)
    priceUsd: 0.01,
    isActive: true,
    lastSeenAt: nowIso
  }
  await store.upsertPaymentOptions(insight.id, [insightOption])

  // 2) MCP server (HTTP transport).
  const mcpUrl = 'http://localhost:4022/mcp'
  const mcp = healthy({
    slug: 'demo-mcp-tools',
    type: 'mcp_server',
    name: 'Demo MCP Tools',
    description:
      'An MCP server exposing utility tools over the streamable HTTP transport. Verified by initialize + tools/list.',
    endpointUrl: mcpUrl,
    origin: originOf(mcpUrl),
    categories: ['agent-tools', 'mcp'],
    tags: ['mcp', 'tools', 'json-rpc'],
    reliabilityScore: 91,
    p50LatencyMs: 80,
    p95LatencyMs: 210
  })
  await store.createListing(mcp)

  // 3) RPC infrastructure (Base mainnet).
  const rpcUrl = 'https://mainnet.base.org'
  const rpc = healthy({
    slug: 'base-rpc',
    type: 'rpc_infra',
    name: 'Base Mainnet RPC',
    description:
      'JSON-RPC endpoint for Base mainnet (eip155:8453). Verified by an eth_blockNumber handshake.',
    endpointUrl: rpcUrl,
    origin: originOf(rpcUrl),
    categories: ['infrastructure', 'rpc'],
    tags: ['rpc', 'base', 'eip155:8453', 'json-rpc'],
    reliabilityScore: 94,
    p50LatencyMs: 60,
    p95LatencyMs: 180
  })
  await store.createListing(rpc)
}
