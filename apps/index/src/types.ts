/**
 * Core domain types for the Prism Index — a verified registry of agent-payable
 * services. Every shape here is storage-agnostic: the same types flow through
 * the in-memory store, the Postgres store, the probers, the health engine, and
 * the HTTP API.
 */

/** The kind of service a listing represents. */
export type ServiceType =
  | 'x402_http_api'
  | 'mcp_server'
  | 'model_endpoint'
  | 'dataset'
  | 'compute'
  | 'storage'
  | 'rpc_infra'
  | 'agent_service'

/**
 * Where a listing sits in its lifecycle. Only `healthy` and `degraded`
 * listings are surfaced to agents by default (and only when `verifiedWorking`).
 */
export type ListingStatus =
  | 'pending_verification'
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'delisted'
  | 'rejected'
  | 'paused'

/** Coarse operational state derived from recent verification runs. */
export type HealthState = 'up' | 'flapping' | 'down' | 'unknown'

/** Result of a single prober run. */
export type CheckOutcome = 'pass' | 'degraded' | 'fail' | 'error'

/** The trust level assigned to a provider (affects ranking, not gating). */
export type ProviderTrustTier =
  | 'unverified'
  | 'community'
  | 'verified'
  | 'partner'

/** What a verification run was checking. */
export type CheckKind = 'preflight' | 'scheduled' | 'manual'

/** A registered owner of one or more listings. */
export interface Provider {
  id: string
  handle: string
  displayName: string
  trustTier: ProviderTrustTier
  createdAt: string
}

/**
 * A concrete, machine-payable way to use a listing. Derived from the live
 * x402 `accepts` array during verification, or declared on submission.
 */
export interface PaymentOption {
  listingId: string
  /** Settlement scheme, e.g. `exact`. */
  scheme: string
  /** CAIP-2 chain id, e.g. `eip155:84532`. */
  networkCaip2: string
  /** Asset identifier (contract address, ASA id, issuer, etc.). */
  asset: string
  assetSymbol: string
  assetDecimals: number
  /** Destination address for the payment. */
  payTo: string
  /** Required amount in atomic units. */
  amountAtomic: string
  /** Best-effort USD price for ranking/filtering. */
  priceUsd?: number
  /** Whether this option was seen in the most recent successful probe. */
  isActive: boolean
  /** ISO timestamp this option was last observed in a live handshake. */
  lastSeenAt?: string
}

/** A ready-to-run instruction an agent can execute without further parsing. */
export interface CallHint {
  method: string
  url: string
  contentType?: string
  /** How to settle payment, e.g. `x402_fetch`. */
  pay_with: 'x402_fetch' | 'mcp' | 'none'
  notes?: string
}

/** The unit of the registry: one verifiable, payable service. */
export interface Listing {
  id: string
  slug: string
  providerId: string
  type: ServiceType
  name: string
  description: string
  endpointUrl: string
  httpMethod?: string
  /** Origin (scheme://host[:port]) extracted from the endpoint. */
  origin: string
  status: ListingStatus
  /** True only when the latest evidence proves the service works and is payable. */
  verifiedWorking: boolean
  lastVerifiedAt?: string
  nextCheckAt: string
  /** Adaptive seconds between scheduled checks. */
  checkIntervalS: number
  consecutiveFails: number
  consecutivePass: number
  /** 0-100 blended reliability score. */
  reliabilityScore: number
  uptime30d?: number
  p50LatencyMs?: number
  p95LatencyMs?: number
  categories: string[]
  tags: string[]
  inputSchema?: unknown
  outputSchema?: unknown
  inputExample?: unknown
  outputExample?: unknown
  callHint?: CallHint
  /** When the listing first entered the `unhealthy` state (for delist grace). */
  enteredUnhealthyAt?: string
  createdAt: string
  updatedAt: string
}

/** A persisted record of one prober execution. */
export interface VerificationRun {
  id: string
  listingId: string
  runAt: string
  checkKind: CheckKind
  outcome: CheckOutcome
  latencyMs?: number
  httpStatus?: number
  detail?: string
  /** Machine-readable failure category, e.g. `no_402`, `timeout`, `bad_schema`. */
  errorClass?: string
  /** Structured extras captured by the prober (e.g. last RPC block height). */
  meta?: Record<string, unknown>
}

/**
 * A real-world usage signal reported by a paying agent (via /v1/feedback).
 * These corroborate the synthetic probes with actual settled payments.
 */
export interface LivenessSignal {
  id: string
  listingId: string
  network: string
  settled: boolean
  latencyMs?: number
  reportedAt: string
}

/** An hourly rollup used to compute uptime cheaply. */
export interface UptimeBucket {
  listingId: string
  /** Bucket start, ISO hour. */
  hourStart: string
  passes: number
  total: number
}

/** A category facet for browsing the registry. */
export interface Category {
  slug: string
  name: string
  count: number
}

/** Filter passed to {@link Store.searchListings}. */
export interface ListingFilter {
  q?: string
  type?: ServiceType
  category?: string
  /** Match listings that offer payment on ANY of these CAIP-2 chains. */
  chains?: string[]
  asset?: string
  maxPriceUsd?: number
  minUptime?: number
  minScore?: number
  /** When true, include `degraded` listings; otherwise healthy-only. */
  includeDegraded?: boolean
  /** When true, ignore the `verifiedWorking` gate (admin/detail views). */
  includeUnverified?: boolean
  statuses?: ListingStatus[]
  limit?: number
  offset?: number
}
