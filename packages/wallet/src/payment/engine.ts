import {
  NoFulfillablePaymentError,
  PolicyDeniedError,
  PrismError
} from '@prism/core'
import type { AdapterRegistry } from '@prism/chains'
import type { PaymentRequired, SignedPayment } from '@prism/protocol'
import { acceptAmount } from '@prism/protocol'
import type { Keyring } from '../keyring/keyring.js'
import type { Ledger } from '../ledger/ledger.js'
import type { PolicyEngine } from '../policy/engine.js'
import { selectAccept, type NegotiateOpts } from './negotiate.js'

export interface PreparedPayment {
  signed: SignedPayment
  amountUsd: number
  payTo: string
  receiptId: string
}

export interface NormalizedResponse {
  status: number
  statusText: string
  body: string
  bodyEncoding: 'text' | 'base64'
  contentType: string | null
  payment?: { amountUsd: number; payTo: string; network: string }
  receiptId?: string
}

export interface FetchOptions extends NegotiateOpts {
  method?: string
  headers?: Record<string, string>
  body?: string
}

function isTextContentType(ct: string | null): boolean {
  if (!ct) return false
  const c = ct.toLowerCase()
  return (
    c.startsWith('text/') ||
    c.includes('application/json') ||
    c.includes('application/xml') ||
    c.includes('application/javascript') ||
    c.includes('+json')
  )
}

async function normalize(res: Response): Promise<NormalizedResponse> {
  const contentType = res.headers.get('content-type')
  if (isTextContentType(contentType)) {
    return {
      status: res.status,
      statusText: res.statusText,
      body: await res.text(),
      bodyEncoding: 'text',
      contentType
    }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    statusText: res.statusText,
    body: buf.toString('base64'),
    bodyEncoding: 'base64',
    contentType
  }
}

/** Decode the server's PaymentRequired from header (preferred) or body. */
async function parsePaymentRequired(res: Response): Promise<PaymentRequired> {
  const header = res.headers.get('Payment-Required')
  if (header) {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
  }
  return (await res.json()) as PaymentRequired
}

/**
 * Negotiates and signs x402 payments. `prepare` produces a header for manual
 * use; `fetch` performs the full pay-and-retry handshake.
 */
export class PaymentEngine {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly keyring: Keyring,
    private readonly policy: PolicyEngine,
    private readonly ledger: Ledger
  ) {}

  private canFund(caip2: string): boolean {
    const adapter = this.registry.get(caip2)
    if (!adapter) return false
    return this.keyring.hasFamily(adapter.info.family)
  }

  /** Negotiate, authorize, and sign — returning a payment header. */
  async prepare(
    req: PaymentRequired,
    opts?: NegotiateOpts & { resourceUrl?: string }
  ): Promise<PreparedPayment> {
    const option = selectAccept(
      req,
      this.registry,
      (c) => this.canFund(c),
      opts
    )
    if (!option) {
      throw new NoFulfillablePaymentError(req.accepts.map((a) => a.network))
    }

    const resourceUrl = opts?.resourceUrl ?? req.resource?.url
    const decision = this.policy.authorize({
      kind: 'x402',
      caip2: option.adapter.info.caip2,
      amountUsd: option.amountUsd,
      to: option.accept.payTo,
      domain: resourceUrl
    })
    if (decision.allow === false) {
      throw new PolicyDeniedError(decision.reason)
    }
    if (decision.allow === 'needs_confirmation') {
      throw new PrismError('NEEDS_CONFIRMATION', decision.reason, {
        token: decision.token,
        amountUsd: option.amountUsd,
        payTo: option.accept.payTo,
        network: option.adapter.info.caip2
      })
    }

    const secret = this.keyring.secretFor(option.adapter.info.family)
    const signed = await option.adapter.x402Sign(option.accept, secret)

    const receipt = this.ledger.recordReceipt({
      resourceUrl,
      caip2: option.adapter.info.caip2,
      scheme: option.accept.scheme,
      assetCaip19: undefined,
      amountAtomic: acceptAmount(option.accept) ?? '0',
      amountUsd: option.amountUsd,
      payTo: option.accept.payTo,
      headerName: signed.headerName,
      status: 'signed'
    })

    return {
      signed,
      amountUsd: option.amountUsd,
      payTo: option.accept.payTo,
      receiptId: receipt.id
    }
  }

  /** Fetch a URL, auto-handling a 402 by paying the cheapest fulfillable option. */
  async fetch(
    url: string,
    opts: FetchOptions = {}
  ): Promise<NormalizedResponse> {
    const method = opts.method ?? 'GET'
    const baseHeaders = opts.headers ?? {}
    const init: RequestInit = { method, headers: baseHeaders }
    if (opts.body && method !== 'GET') init.body = opts.body

    const initial = await fetch(url, init)
    if (initial.status !== 402) {
      return normalize(initial)
    }

    const req = await parsePaymentRequired(initial)
    if (!req.accepts?.length) {
      throw new PrismError(
        'PAYMENT_FAILED',
        'Server returned 402 with no payment options.'
      )
    }
    if (!req.resource) req.resource = { url }

    const prepared = await this.prepare(req, {
      prefer: opts.prefer,
      preferredChains: opts.preferredChains,
      maxAmountUsd: opts.maxAmountUsd,
      resourceUrl: url
    })

    const retryHeaders = {
      ...baseHeaders,
      [prepared.signed.headerName]: prepared.signed.headerValue
    }
    const retryInit: RequestInit = { method, headers: retryHeaders }
    if (opts.body && method !== 'GET') retryInit.body = opts.body

    const paid = await fetch(url, retryInit)
    const result = await normalize(paid)

    this.ledger.recordSpend({
      kind: 'x402',
      caip2: prepared.signed.network,
      assetCaip19: undefined,
      amountAtomic: '0',
      amountUsd: prepared.amountUsd,
      to: prepared.payTo,
      domain: url,
      status: paid.ok ? 'recorded' : 'failed'
    })

    result.payment = {
      amountUsd: prepared.amountUsd,
      payTo: prepared.payTo,
      network: prepared.signed.network
    }
    result.receiptId = prepared.receiptId
    return result
  }
}
