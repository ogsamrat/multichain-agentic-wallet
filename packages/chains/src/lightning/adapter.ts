import { PrismError, UnsupportedCapabilityError } from '@prism/core'
import type { ChainAdapter, Invoicing } from '../adapter.js'
import type {
  AssetRef,
  Balance,
  Capability,
  ChainInfo,
  ChainSecret,
  FeeEstimate,
  SendOpts,
  SimResult,
  TransferIntent,
  TxRef,
  TxStatus
} from '../types.js'
import type { LightningNetwork } from './networks.js'

const CAPS: Capability[] = ['invoicing']

/** A parsed `connect` string: an LNbits-compatible base URL plus its API key. */
interface LnConnection {
  baseUrl: string
  apiKey: string
}

/**
 * Lightning adapter backed by an LNbits-compatible REST node.
 *
 * Unlike account/UTXO chains, Lightning has no addresses or on-chain transfers:
 * value moves through BOLT-11 invoices. The adapter therefore advertises only
 * the `invoicing` capability and routes `send` to a clear error. The backend is
 * configured entirely through the family secret's `connect` string
 * (`<baseUrl>|<apiKey>`), e.g. `https://demo.lnbits.com|abc123`.
 *
 * LNbits assumptions: the invoice (read) and admin (pay) operations use the
 * same key supplied in `connect`. A real deployment may hold separate invoice
 * and admin keys; here a single key is used for both, which works when the
 * provided key has admin scope.
 */
export class LightningAdapter implements ChainAdapter, Invoicing {
  readonly info: ChainInfo
  readonly capabilities: ReadonlySet<Capability> = new Set(CAPS)

  private readonly net: LightningNetwork

  constructor(net: LightningNetwork) {
    this.net = net
    this.info = {
      caip2: net.caip2,
      family: 'lightning',
      accountModel: 'utxo+ln',
      displayName: net.displayName,
      aliases: net.aliases,
      testnet: net.testnet,
      nativeAsset: this.nativeAsset()
    }
  }

  supports(cap: Capability): boolean {
    return this.capabilities.has(cap)
  }

  // ── identity ───────────────────────────────────────────────────────────────

  /**
   * Lightning has no address. Best-effort: return the backend wallet id, or an
   * empty string if the node is unreachable.
   */
  async deriveAddress(secret: ChainSecret): Promise<string> {
    try {
      const wallet = await this.walletInfo(this.parseConnect(secret))
      return wallet.id ?? ''
    } catch {
      return ''
    }
  }

  // ── assets ───────────────────────────────────────────────────────────────

  private nativeAsset(): AssetRef {
    return {
      caip19: `${this.net.caip2}/native:sat`,
      symbol: this.net.nativeSymbol,
      decimals: this.net.nativeDecimals,
      native: true
    }
  }

  async resolveAsset(ref: string): Promise<AssetRef | null> {
    const lower = ref.trim().toLowerCase()
    if (
      lower === 'native' ||
      lower === 'sats' ||
      lower === 'sat' ||
      lower === 'btc'
    ) {
      return this.nativeAsset()
    }
    return null
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Lightning balances are not address-scoped; the wallet balance comes from
   * the backend (returned in msat, converted to sats). The `address` argument
   * is ignored. This adapter needs a secret to read balances, so it is only
   * usable via flows that supply one — `getNativeBalance` here always queries
   * the configured node via the env-provided connection.
   */
  async getNativeBalance(_address: string): Promise<Balance> {
    const conn = this.connectionFromEnv()
    const wallet = await this.walletInfo(conn)
    const sats = BigInt(Math.floor((wallet.balance ?? 0) / 1000))
    return {
      asset: this.nativeAsset(),
      atomic: sats,
      human: sats.toString()
    }
  }

  async getTokenBalances(
    _address: string,
    _assets?: AssetRef[]
  ): Promise<Balance[]> {
    return []
  }

  /** `hash` is a BOLT-11 payment hash; paid → confirmed, otherwise pending. */
  async getTxStatus(hash: string): Promise<TxStatus> {
    try {
      const conn = this.connectionFromEnv()
      const payment = await this.lnbitsJson<{ paid?: boolean }>(
        conn,
        `/api/v1/payments/${hash}`
      )
      return payment.paid ? 'confirmed' : 'pending'
    } catch {
      return 'unknown'
    }
  }

  explorerUrl(_ref: {
    tx?: string
    address?: string
    asset?: string
  }): string | undefined {
    return undefined
  }

  // ── fee / simulate ───────────────────────────────────────────────────────

  /** Routing fees are quoted by the node at pay time; estimate ~0 here. */
  async estimateFee(_intent: TransferIntent): Promise<FeeEstimate> {
    const asset = this.nativeAsset()
    return { asset, atomic: 0n, human: '0', tier: 'normal' }
  }

  async simulate(intent: TransferIntent, _from: string): Promise<SimResult> {
    const fee = await this.estimateFee(intent)
    return {
      ok: true,
      fee,
      warnings: [
        'Lightning moves value via invoices; use create_invoice / pay_invoice rather than send.'
      ]
    }
  }

  // ── send (unsupported) ─────────────────────────────────────────────────────

  async send(
    _intent: TransferIntent,
    _secret: ChainSecret,
    _opts?: SendOpts
  ): Promise<TxRef> {
    // Surface the canonical UNSUPPORTED_CAPABILITY code with a Lightning-specific
    // hint. UnsupportedCapabilityError carries the same code; PrismError lets us
    // attach the create_invoice/pay_invoice guidance callers expect.
    throw new PrismError(
      'UNSUPPORTED_CAPABILITY',
      'Lightning uses invoices; use pay_invoice/create_invoice.',
      { capability: 'native_transfer', chain: this.net.caip2 }
    )
  }

  // ── invoicing ──────────────────────────────────────────────────────────────

  async createInvoice(
    req: { amountAtomic?: bigint; memo?: string; expirySeconds?: number },
    secret: ChainSecret
  ): Promise<{ invoice: string; paymentHash: string }> {
    const conn = this.parseConnect(secret)
    const body: Record<string, unknown> = {
      out: false,
      amount: Number(req.amountAtomic ?? 0n),
      memo: req.memo ?? ''
    }
    if (req.expirySeconds !== undefined) body.expiry = req.expirySeconds
    const res = await this.lnbitsJson<{
      payment_request: string
      payment_hash: string
    }>(conn, '/api/v1/payments', 'POST', body)
    return { invoice: res.payment_request, paymentHash: res.payment_hash }
  }

  async payInvoice(
    invoice: string,
    secret: ChainSecret,
    _opts?: { maxFeeAtomic?: bigint }
  ): Promise<{ preimage: string; feeAtomic: bigint }> {
    const conn = this.parseConnect(secret)
    const res = await this.lnbitsJson<{
      payment_hash: string
      preimage?: string
      fee_msat?: number
    }>(conn, '/api/v1/payments', 'POST', { out: true, bolt11: invoice })

    let preimage = res.preimage ?? ''
    let feeMsat = res.fee_msat ?? 0
    // LNbits often returns only payment_hash; fetch the settled payment to
    // recover the preimage and the actual routing fee.
    if (!preimage && res.payment_hash) {
      try {
        const detail = await this.lnbitsJson<{
          preimage?: string
          fee?: number
          details?: { fee?: number; preimage?: string }
        }>(conn, `/api/v1/payments/${res.payment_hash}`)
        preimage = detail.preimage ?? detail.details?.preimage ?? ''
        feeMsat = detail.fee ?? detail.details?.fee ?? feeMsat
      } catch {
        // Leave preimage/fee as-is if the lookup fails.
      }
    }
    return {
      preimage,
      feeAtomic: BigInt(Math.floor(Math.abs(feeMsat) / 1000))
    }
  }

  /**
   * Decode a BOLT-11 invoice via the backend. Returns `{}` gracefully if the
   * node does not expose a decode endpoint.
   */
  async decodeInvoice(
    invoice: string
  ): Promise<{ amountAtomic?: bigint; description?: string; payee?: string }> {
    try {
      const conn = this.connectionFromEnv()
      const res = await this.lnbitsJson<{
        amount_msat?: number
        description?: string
        payee?: string
      }>(conn, '/api/v1/payments/decode', 'POST', { data: invoice })
      const out: {
        amountAtomic?: bigint
        description?: string
        payee?: string
      } = {}
      if (res.amount_msat !== undefined) {
        out.amountAtomic = BigInt(Math.floor(res.amount_msat / 1000))
      }
      if (res.description !== undefined) out.description = res.description
      if (res.payee !== undefined) out.payee = res.payee
      return out
    } catch {
      return {}
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Parse the family secret's `connect` string into a base URL + API key. */
  private parseConnect(secret: ChainSecret): LnConnection {
    if (secret.family !== 'lightning') {
      throw new PrismError(
        'NO_KEY_FOR_CHAIN',
        `Lightning adapter received a ${secret.family} secret.`
      )
    }
    return this.parseConnectString(secret.connect)
  }

  private parseConnectString(connect: string): LnConnection {
    const idx = connect.indexOf('|')
    if (idx === -1) {
      throw new PrismError(
        'CONFIG_ERROR',
        'Lightning connect string must be "<baseUrl>|<apiKey>".'
      )
    }
    const baseUrl = connect.slice(0, idx).trim().replace(/\/+$/, '')
    const apiKey = connect.slice(idx + 1).trim()
    if (!baseUrl || !apiKey) {
      throw new PrismError(
        'CONFIG_ERROR',
        'Lightning connect string is missing a base URL or API key.'
      )
    }
    return { baseUrl, apiKey }
  }

  /**
   * Some read flows (balance, decode, status) do not receive a secret. They
   * fall back to a connection configured via `PRISM_LIGHTNING_CONNECT`.
   */
  private connectionFromEnv(): LnConnection {
    const connect = process.env.PRISM_LIGHTNING_CONNECT
    if (!connect) {
      throw new PrismError(
        'CONFIG_ERROR',
        'No Lightning connection available; set PRISM_LIGHTNING_CONNECT or supply a secret.'
      )
    }
    return this.parseConnectString(connect)
  }

  private async walletInfo(
    conn: LnConnection
  ): Promise<{ id?: string; balance?: number }> {
    return this.lnbitsJson<{ id?: string; balance?: number }>(
      conn,
      '/api/v1/wallet'
    )
  }

  private async lnbitsJson<T>(
    conn: LnConnection,
    path: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown
  ): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${conn.baseUrl}${path}`, {
        method,
        headers: {
          'X-Api-Key': conn.apiKey,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      })
    } catch (err) {
      throw new PrismError(
        'INTERNAL',
        `Lightning backend unreachable at ${conn.baseUrl}${path}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new PrismError(
        'INTERNAL',
        `Lightning backend error (${res.status}) for ${path}: ${text}`,
        { status: res.status }
      )
    }
    return (await res.json()) as T
  }
}

// Re-exported for symmetry with other adapters that expose a typed guard error.
export { UnsupportedCapabilityError }
