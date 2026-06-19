/**
 * Prober registry + shared probe primitives.
 *
 * A prober verifies that one kind of service genuinely works by performing the
 * protocol's REAL handshake — never by trusting submitted metadata. Each prober
 * is a pure async function `(listing) => ProbeResult`; the health engine decides
 * the consequences (state transitions, scoring, scheduling).
 */
import type { Listing, PaymentOption } from '../types.js'
import { probeMcp } from './mcp.js'
import { probeRpc } from './rpc.js'
import { probeX402 } from './x402.js'

/** The bounded result of a single probe. Probers never mutate state. */
export interface ProbeResult {
  outcome: 'pass' | 'degraded' | 'fail' | 'error'
  latencyMs: number
  httpStatus?: number
  /** Structured, prober-specific detail (serialized when persisted). */
  detail?: unknown
  /** Machine-readable failure category, e.g. `no_402`, `timeout`. */
  errorClass?: string
  /** Payment options derived from a live handshake (x402 `accepts`). */
  paymentOptions?: PaymentOption[]
}

export { probeX402 } from './x402.js'
export { probeMcp } from './mcp.js'
export { probeRpc } from './rpc.js'

/** Default per-probe timeout. Probes must be fast and bounded. */
export const PROBE_TIMEOUT_MS = 10_000

/** Fetch with an AbortController timeout; also returns measured latency. */
export async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<{ response: Response; latencyMs: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return { response, latencyMs: Date.now() - start }
  } finally {
    clearTimeout(timer)
  }
}

/** Generates a fresh id (crypto.randomUUID where available). */
export function genId(prefix = 'id'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/** Classifies a thrown network error into a coarse, stable bucket. */
export function classifyNetworkError(err: unknown): string {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (m.includes('abort') || m.includes('timeout')) return 'timeout'
  if (m.includes('econnrefused') || m.includes('refused')) return 'conn_refused'
  if (m.includes('enotfound') || m.includes('dns')) return 'dns'
  return 'network'
}

/** Normalizes any thrown value to a message string. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Generic reachability probe for service types without a bespoke handshake
 * (model_endpoint, dataset, compute, storage, agent_service). Tries a HEAD,
 * falling back to GET, and passes on any 2xx (or a 401/402/403 gate, which
 * proves the endpoint is alive and intentionally guarded).
 */
export async function probeReachable(listing: Listing): Promise<ProbeResult> {
  const tryOnce = async (method: 'HEAD' | 'GET'): Promise<ProbeResult> => {
    const { response, latencyMs } = await timedFetch(listing.endpointUrl, {
      method,
      headers: { accept: '*/*' }
    })
    const s = response.status
    if (s >= 200 && s < 300) {
      return { outcome: 'pass', latencyMs, httpStatus: s, detail: { method } }
    }
    if (s === 401 || s === 402 || s === 403) {
      // Alive and intentionally gated — usable, just not anonymously.
      return {
        outcome: 'degraded',
        latencyMs,
        httpStatus: s,
        detail: { method, gated: true }
      }
    }
    return {
      outcome: 'fail',
      latencyMs,
      httpStatus: s,
      detail: { method },
      errorClass: s >= 500 ? 'server_error' : 'unexpected_status'
    }
  }

  try {
    const head = await tryOnce('HEAD')
    if (head.outcome === 'pass' || head.outcome === 'degraded') return head
    // Some servers reject HEAD; retry with GET before giving up.
    return await tryOnce('GET')
  } catch (err) {
    return {
      outcome: 'error',
      latencyMs: 0,
      detail: { error: errMessage(err) },
      errorClass: classifyNetworkError(err)
    }
  }
}

/** Dispatches to the right prober for a listing's service type. */
export async function probe(listing: Listing): Promise<ProbeResult> {
  switch (listing.type) {
    case 'x402_http_api':
      return probeX402(listing)
    case 'mcp_server':
      return probeMcp(listing)
    case 'rpc_infra':
      return probeRpc(listing)
    default:
      return probeReachable(listing)
  }
}
