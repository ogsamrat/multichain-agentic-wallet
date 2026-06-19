import { acceptAmount } from '@prism/protocol'
import type { PaymentAccept, PaymentRequired } from '@prism/protocol'
import type { Listing, PaymentOption } from '../types.js'
import type { ProbeResult } from './index.js'
import { classifyNetworkError, errMessage, timedFetch } from './index.js'

/**
 * Known stablecoin metadata for symbol/USD enrichment, keyed by lower-cased
 * `caip2:contract`. Only used to make rankings nicer — the handshake itself
 * never depends on it.
 */
const KNOWN_ASSETS: Record<
  string,
  { symbol: string; decimals: number; usdPerUnit: number }
> = {
  // USDC on Base Sepolia
  'eip155:84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e': {
    symbol: 'USDC',
    decimals: 6,
    usdPerUnit: 1
  },
  // USDC on Base mainnet
  'eip155:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': {
    symbol: 'USDC',
    decimals: 6,
    usdPerUnit: 1
  }
}

/**
 * Verifies an x402-gated HTTP API by performing the REAL 402 handshake.
 *
 * Strategy (ported, not imported, from the prism-ref parse logic):
 *  1. Call the endpoint with NO payment header. Expect HTTP 402.
 *  2. Read the base64 `Payment-Required` response header first, else fall back
 *     to the JSON body. Validate `x402Version` is a number and `accepts` is a
 *     non-empty array, each with scheme/network/payTo and an amount
 *     (`amount` v2 or `maxAmountRequired` v1).
 *
 * Outcomes:
 *  - pass:     valid 402 with >= 1 fully-described, parseable accept.
 *  - degraded: 402 with accepts, but some are missing asset/amount metadata.
 *  - fail:     200 (no gate), a non-402 status, or a malformed 402 payload.
 *  - error:    the request itself could not be completed.
 *
 * This prober NEVER signs or sends a real payment.
 */
export async function probeX402(listing: Listing): Promise<ProbeResult> {
  const method = (listing.httpMethod ?? 'GET').toUpperCase()
  const body =
    method !== 'GET' && method !== 'HEAD'
      ? JSON.stringify(listing.inputExample ?? {})
      : undefined

  // --- Step 1: unpaid request, expect 402 -------------------------------
  let res: Response
  let latencyMs: number
  try {
    const r = await timedFetch(listing.endpointUrl, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body } : {})
    })
    res = r.response
    latencyMs = r.latencyMs
  } catch (err) {
    return {
      outcome: 'error',
      latencyMs: 0,
      detail: { error: `Request failed: ${errMessage(err)}` },
      errorClass: classifyNetworkError(err)
    }
  }

  if (res.status === 200) {
    return {
      outcome: 'fail',
      latencyMs,
      httpStatus: 200,
      detail: { error: 'Endpoint returned 200 without an x402 payment gate.' },
      errorClass: 'no_gate'
    }
  }

  if (res.status !== 402) {
    return {
      outcome: 'fail',
      latencyMs,
      httpStatus: res.status,
      detail: { error: `Expected HTTP 402, got ${res.status}.` },
      errorClass: res.status >= 500 ? 'server_error' : 'unexpected_status'
    }
  }

  // --- Step 2: parse + validate the PaymentRequired payload -------------
  let parsed: PaymentRequired
  try {
    parsed = await parsePaymentRequired(res)
  } catch (err) {
    return {
      outcome: 'fail',
      latencyMs,
      httpStatus: 402,
      detail: {
        error: `402 received but payment requirements were malformed: ${errMessage(err)}`
      },
      errorClass: 'malformed_402'
    }
  }

  const accepts = parsed.accepts
  const { options, fullyDescribed } = deriveOptions(listing.id, accepts)

  const detail = {
    acceptsCount: accepts.length,
    networks: dedupe(accepts.map((a) => a.network)),
    schemes: dedupe(accepts.map((a) => a.scheme)),
    fullyDescribed
  }

  // pass iff >= 1 parseable accept AND every accept is fully described.
  // degraded if it's a 402 with accepts but some lack asset/amount.
  const outcome = fullyDescribed ? 'pass' : 'degraded'

  return {
    outcome,
    latencyMs,
    httpStatus: 402,
    detail,
    errorClass: outcome === 'degraded' ? 'incomplete_metadata' : undefined,
    paymentOptions: options
  }
}

/**
 * Reads and validates the PaymentRequired payload. Prefers the base64
 * `Payment-Required` header (x402 v2), falling back to the JSON body (v1).
 * Throws if the shape is invalid.
 */
export async function parsePaymentRequired(
  res: Response
): Promise<PaymentRequired> {
  let raw: unknown

  const headerVal =
    res.headers.get('payment-required') ?? res.headers.get('Payment-Required')
  if (headerVal) {
    raw = JSON.parse(decodeBase64Utf8(headerVal))
  } else {
    const text = await res.text()
    if (!text.trim()) {
      throw new Error('402 had neither a Payment-Required header nor a body')
    }
    raw = JSON.parse(text)
  }

  return validatePaymentRequired(raw)
}

/** Validates the parsed value matches the x402 PaymentRequired contract. */
export function validatePaymentRequired(raw: unknown): PaymentRequired {
  if (!raw || typeof raw !== 'object') {
    throw new Error('paymentRequirements must be an object')
  }
  const req = raw as Record<string, unknown>
  if (typeof req.x402Version !== 'number') {
    throw new Error('x402Version must be a number')
  }
  if (!Array.isArray(req.accepts) || req.accepts.length === 0) {
    throw new Error('accepts must be a non-empty array')
  }
  for (const a of req.accepts as Array<Record<string, unknown>>) {
    if (typeof a.scheme !== 'string' || !a.scheme) {
      throw new Error('each accept needs a scheme')
    }
    if (typeof a.network !== 'string' || !a.network) {
      throw new Error('each accept needs a network')
    }
    if (typeof a.payTo !== 'string' || !a.payTo) {
      throw new Error('each accept needs a payTo')
    }
    const amount = (a.amount ?? a.maxAmountRequired) as unknown
    if (typeof amount !== 'string' && typeof amount !== 'number') {
      throw new Error('each accept needs amount or maxAmountRequired')
    }
  }
  return req as unknown as PaymentRequired
}

/**
 * Maps live `accepts` to PaymentOption rows and reports whether every accept
 * carried enough metadata (asset + amount) to be considered fully described.
 */
function deriveOptions(
  listingId: string,
  accepts: PaymentAccept[]
): { options: PaymentOption[]; fullyDescribed: boolean } {
  let fullyDescribed = true
  const now = new Date().toISOString()
  const options: PaymentOption[] = accepts.map((a) => {
    const atomic = acceptAmount(a)
    const assetAddr = a.asset ?? ''
    if (!assetAddr || !atomic) fullyDescribed = false

    const known =
      KNOWN_ASSETS[`${a.network}:${assetAddr.toLowerCase()}`.toLowerCase()]
    const decimals = known?.decimals ?? guessDecimals(a)
    const amountAtomic = String(atomic ?? '0')
    const priceUsd = known
      ? (Number(amountAtomic) / 10 ** decimals) * known.usdPerUnit
      : undefined

    return {
      listingId,
      scheme: a.scheme,
      networkCaip2: a.network,
      asset: assetAddr,
      assetSymbol: known?.symbol ?? '',
      assetDecimals: decimals,
      payTo: a.payTo,
      amountAtomic,
      priceUsd,
      isActive: true,
      lastSeenAt: now
    }
  })
  return { options, fullyDescribed }
}

function guessDecimals(a: PaymentAccept): number {
  const extra = a.extra as { decimals?: unknown } | undefined
  if (extra && typeof extra.decimals === 'number') return extra.decimals
  return 6 // USDC-style default
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

function decodeBase64Utf8(value: string): string {
  // Works on both Node and Workers. Prefer Buffer when present.
  const maybeBuffer = (
    globalThis as {
      Buffer?: { from(s: string, e: string): { toString(e: string): string } }
    }
  ).Buffer
  if (maybeBuffer) {
    return maybeBuffer.from(value, 'base64').toString('utf-8')
  }
  const bin = atob(value)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
