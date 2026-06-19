import {
  Asset,
  BASE_FEE,
  Federation,
  Horizon,
  Keypair,
  Memo,
  Operation,
  StrKey,
  TransactionBuilder
} from '@stellar/stellar-sdk'
import { PrismError } from '@prism/core'
import type { PaymentAccept, SignedPayment } from '@prism/protocol'
import type {
  AllowanceManaging,
  ChainAdapter,
  FundingUriBuilding,
  MessageSigning,
  NameResolving,
  X402Capable
} from '../adapter.js'
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
import type { StellarNetwork } from './networks.js'
import {
  USDC_CODE,
  USDC_DECIMALS,
  XLM_DECIMALS,
  horizonUrlFor
} from './networks.js'
import { stellarX402Sign } from './x402.js'

const CAPS: Capability[] = [
  'native_transfer',
  'token_transfer',
  'token_balance',
  'name_resolution',
  'x402_pay',
  'allowance',
  'message_signing',
  'funding_uri'
]

/** Stellar amounts are fixed at 7 decimals on the wire. */
const STROOPS_PER_UNIT = 10_000_000n

/** Format an atomic (7dp) amount as a human decimal string. */
function toHuman(atomic: bigint, decimals: number): string {
  const neg = atomic < 0n
  const abs = neg ? -atomic : atomic
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = (abs % base).toString().padStart(decimals, '0')
  const trimmed = frac.replace(/0+$/, '')
  const sign = neg ? '-' : ''
  return trimmed ? `${sign}${whole}.${trimmed}` : `${sign}${whole}`
}

/** Convert an atomic (7dp) bigint into the decimal string Stellar ops expect. */
function atomicToStellarAmount(atomic: bigint): string {
  return toHuman(atomic, XLM_DECIMALS)
}

/** Convert a decimal string (max 7dp) into an atomic 7dp bigint. */
function humanToAtomic(human: string): bigint {
  const [whole, frac = ''] = human.split('.')
  const fracPadded = (frac + '0000000').slice(0, 7)
  return BigInt(whole || '0') * STROOPS_PER_UNIT + BigInt(fracPadded || '0')
}

/**
 * One adapter instance serves one Stellar network. Stellar is an account-model
 * chain: balances live on funded accounts, non-native assets require an explicit
 * trustline before they can be held, and fees are paid in native XLM (stroops).
 */
export class StellarAdapter
  implements
    ChainAdapter,
    NameResolving,
    X402Capable,
    AllowanceManaging,
    MessageSigning,
    FundingUriBuilding
{
  readonly info: ChainInfo
  readonly capabilities: ReadonlySet<Capability> = new Set(CAPS)

  private readonly net: StellarNetwork
  private _server?: Horizon.Server

  constructor(net: StellarNetwork) {
    this.net = net
    this.info = {
      caip2: net.caip2,
      family: 'stellar',
      accountModel: 'account',
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

  /** Build a `Keypair` from a Stellar `S...` secret or a 32-byte raw seed. */
  private keypair(secret: ChainSecret): Keypair {
    this.assertStellar(secret)
    if (secret.secret) return Keypair.fromSecret(secret.secret)
    if (secret.seed) return Keypair.fromRawEd25519Seed(Buffer.from(secret.seed))
    throw new PrismError('NO_KEY_FOR_CHAIN', 'Stellar secret has no key.')
  }

  async deriveAddress(secret: ChainSecret): Promise<string> {
    return this.keypair(secret).publicKey()
  }

  // ── assets ───────────────────────────────────────────────────────────────

  private nativeAsset(): AssetRef {
    return {
      caip19: `${this.net.caip2}/slip44:148`,
      symbol: 'XLM',
      decimals: XLM_DECIMALS,
      native: true,
      name: 'Stellar Lumens'
    }
  }

  private usdcAsset(): AssetRef {
    const issuer = this.net.usdcIssuer
    return {
      caip19: `${this.net.caip2}/stellar:${USDC_CODE}.${issuer}`,
      symbol: USDC_CODE,
      decimals: USDC_DECIMALS,
      native: false,
      name: 'USD Coin',
      reference: issuer
    }
  }

  /** Build an `AssetRef` for an arbitrary `CODE:ISSUER` classic asset. */
  private customAsset(code: string, issuer: string): AssetRef | null {
    if (!StrKey.isValidEd25519PublicKey(issuer)) return null
    return {
      caip19: `${this.net.caip2}/stellar:${code}.${issuer}`,
      symbol: code,
      decimals: USDC_DECIMALS,
      native: false,
      reference: issuer
    }
  }

  async resolveAsset(ref: string): Promise<AssetRef | null> {
    const trimmed = ref.trim()
    const lower = trimmed.toLowerCase()
    if (lower === 'native' || lower === 'xlm') return this.nativeAsset()
    if (lower === 'usdc') return this.usdcAsset()
    if (trimmed.includes(':')) {
      const [code, issuer] = trimmed.split(':')
      if (code && issuer) return this.customAsset(code, issuer)
    }
    return null
  }

  /** Map an `AssetRef` onto a Stellar SDK `Asset` (native or classic credit). */
  private toStellarAsset(asset: AssetRef): Asset {
    if (asset.native) return Asset.native()
    if (!asset.reference) {
      throw new PrismError('INTERNAL', 'Stellar asset missing issuer.')
    }
    return new Asset(asset.symbol, asset.reference)
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  async getNativeBalance(address: string): Promise<Balance> {
    const asset = this.nativeAsset()
    try {
      const account = await this.server().loadAccount(address)
      const line = account.balances.find((b) => b.asset_type === 'native')
      const human = line?.balance ?? '0'
      return { asset, atomic: humanToAtomic(human), human }
    } catch {
      // Unfunded / non-existent account → zero balance.
      return { asset, atomic: 0n, human: '0' }
    }
  }

  async getTokenBalances(
    address: string,
    assets?: AssetRef[]
  ): Promise<Balance[]> {
    const wanted = assets ?? [this.usdcAsset()]
    let lines: Horizon.ServerApi.AccountRecord['balances'] = []
    try {
      const account = await this.server().loadAccount(address)
      lines = account.balances
    } catch {
      // Unfunded account holds no trustlines.
      return wanted.map((asset) => ({ asset, atomic: 0n, human: '0' }))
    }
    return wanted.map((asset) => {
      const human =
        lines.find(
          (b) =>
            'asset_code' in b &&
            b.asset_code === asset.symbol &&
            ('asset_issuer' in b ? b.asset_issuer === asset.reference : true)
        )?.balance ?? '0'
      return { asset, atomic: humanToAtomic(human), human }
    })
  }

  async getTxStatus(hash: string): Promise<TxStatus> {
    try {
      const tx = await this.server().transactions().transaction(hash).call()
      return tx.successful ? 'confirmed' : 'failed'
    } catch {
      // Horizon returns 404 until a transaction is included in a ledger.
      return 'unknown'
    }
  }

  explorerUrl(ref: {
    tx?: string
    address?: string
    asset?: string
  }): string | undefined {
    const base = this.net.explorerBase
    if (ref.tx) return `${base}/tx/${ref.tx}`
    if (ref.address) return `${base}/account/${ref.address}`
    if (ref.asset) return `${base}/asset/${ref.asset}`
    return undefined
  }

  // ── fee / simulate ───────────────────────────────────────────────────────

  async estimateFee(intent: TransferIntent): Promise<FeeEstimate> {
    // A single-operation transaction costs BASE_FEE stroops (100 = 0.00001 XLM).
    const atomic = BigInt(BASE_FEE)
    const native = this.nativeAsset()
    return {
      asset: native,
      atomic,
      human: toHuman(atomic, native.decimals),
      tier: intent.feeTier ?? 'normal'
    }
  }

  async simulate(intent: TransferIntent, from: string): Promise<SimResult> {
    const warnings: string[] = []
    const fee = await this.estimateFee(intent)
    try {
      const native = await this.getNativeBalance(from)
      if (native.atomic === 0n) {
        warnings.push('Source account is unfunded (needs a 1 XLM reserve).')
      }
      if (intent.asset.native) {
        if (native.atomic < intent.amountAtomic + fee.atomic) {
          warnings.push(
            'XLM balance may not cover amount plus fee and reserve.'
          )
        }
      } else {
        if (native.atomic < fee.atomic) {
          warnings.push('XLM balance may not cover the network fee.')
        }
        const [bal] = await this.getTokenBalances(from, [intent.asset])
        if (!bal || bal.atomic < intent.amountAtomic) {
          warnings.push('Token balance may be insufficient.')
        }
        const hasTrustline = await this.hasTrustline(
          intent.to,
          intent.asset
        ).catch(() => true)
        if (!hasTrustline) {
          warnings.push(
            `Destination has no ${intent.asset.symbol} trustline; payment will fail.`
          )
        }
      }
    } catch {
      warnings.push('Could not read balances for simulation.')
    }
    return { ok: warnings.length === 0, fee, warnings }
  }

  // ── send ─────────────────────────────────────────────────────────────────

  async send(
    intent: TransferIntent,
    secret: ChainSecret,
    opts?: SendOpts
  ): Promise<TxRef> {
    const keypair = this.keypair(secret)
    const server = this.server()
    const source = await server.loadAccount(keypair.publicKey())
    const asset = this.toStellarAsset(intent.asset)

    if (!intent.asset.native) {
      // Classic assets require the destination to hold a trustline first.
      const hasTrustline = await this.hasTrustline(intent.to, intent.asset)
      if (!hasTrustline) {
        throw new PrismError(
          'PAYMENT_FAILED',
          `Destination ${intent.to} has no ${intent.asset.symbol} trustline.`,
          { to: intent.to, asset: intent.asset.symbol }
        )
      }
    }

    const builder = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.net.networkPassphrase
    }).addOperation(
      Operation.payment({
        destination: intent.to,
        asset,
        amount: atomicToStellarAmount(intent.amountAtomic)
      })
    )
    if (intent.memo) builder.addMemo(Memo.text(intent.memo))

    const tx = builder.setTimeout(180).build()
    tx.sign(keypair)

    let hash: string
    try {
      const res = await server.submitTransaction(tx)
      hash = res.hash
    } catch (err) {
      throw new PrismError('PAYMENT_FAILED', this.horizonErrorMessage(err), {
        cause: String(err)
      })
    }

    if (opts?.waitForConfirmation) {
      await this.waitForTx(hash)
    }
    return {
      hash,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: hash })
    }
  }

  // ── x402 ─────────────────────────────────────────────────────────────────

  async x402Sign(
    accept: PaymentAccept,
    secret: ChainSecret
  ): Promise<SignedPayment> {
    this.assertStellar(secret)
    return stellarX402Sign(this.net, accept, secret)
  }

  x402BuildAccept(params: {
    asset: AssetRef
    payTo: string
    amountAtomic: bigint
    resource?: string
  }): PaymentAccept {
    const issuer = params.asset.reference ?? this.net.usdcIssuer
    const asset = params.asset.native
      ? 'native'
      : params.asset.reference
        ? `${params.asset.symbol}:${issuer}`
        : `${USDC_CODE}:${this.net.usdcIssuer}`
    return {
      scheme: 'exact',
      network: this.net.caip2,
      asset,
      payTo: params.payTo,
      amount: String(params.amountAtomic),
      maxTimeoutSeconds: 300,
      extra: {}
    }
  }

  // ── allowances (modelled as Stellar trustlines) ────────────────────────────

  /**
   * Stellar has no ERC-20-style allowance. The closest concept is a *trustline*:
   * before an account can hold a classic asset it must establish a trustline,
   * optionally capped by a limit. We map `getAllowance` onto the owner's
   * trustline limit (0 when no trustline exists) and `setAllowance` onto a
   * `changeTrust` operation that creates or raises that limit. The `spender`
   * argument is ignored — trustlines are not per-counterparty.
   */
  async getAllowance(
    owner: string,
    _spender: string,
    asset: AssetRef
  ): Promise<bigint> {
    if (asset.native) return 0n
    try {
      const account = await this.server().loadAccount(owner)
      const line = account.balances.find(
        (b) =>
          'asset_code' in b &&
          b.asset_code === asset.symbol &&
          'asset_issuer' in b &&
          b.asset_issuer === asset.reference
      )
      if (!line || !('limit' in line) || !line.limit) return 0n
      return humanToAtomic(line.limit)
    } catch {
      return 0n
    }
  }

  async setAllowance(
    _spender: string,
    asset: AssetRef,
    amountAtomic: bigint,
    secret: ChainSecret
  ): Promise<TxRef> {
    if (asset.native) {
      throw new PrismError(
        'UNSUPPORTED_CAPABILITY',
        'Native XLM does not use trustlines.'
      )
    }
    const keypair = this.keypair(secret)
    const server = this.server()
    const source = await server.loadAccount(keypair.publicKey())
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.net.networkPassphrase
    })
      .addOperation(
        Operation.changeTrust({
          asset: this.toStellarAsset(asset),
          limit: atomicToStellarAmount(amountAtomic)
        })
      )
      .setTimeout(180)
      .build()
    tx.sign(keypair)
    let hash: string
    try {
      const res = await server.submitTransaction(tx)
      hash = res.hash
    } catch (err) {
      throw new PrismError('PAYMENT_FAILED', this.horizonErrorMessage(err), {
        cause: String(err)
      })
    }
    return {
      hash,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: hash })
    }
  }

  // ── message signing ──────────────────────────────────────────────────────

  async signMessage(
    message: string,
    secret: ChainSecret
  ): Promise<{ signature: string; scheme: string }> {
    const keypair = this.keypair(secret)
    const signature = keypair.sign(Buffer.from(message)).toString('base64')
    return { signature, scheme: 'ed25519' }
  }

  // ── funding URI (SEP-0007) ────────────────────────────────────────────────

  buildFundingUri(req: {
    address: string
    asset: AssetRef
    amountAtomic?: bigint
  }): string {
    const { address, asset, amountAtomic } = req
    const params: string[] = [`destination=${address}`]
    if (amountAtomic !== undefined) {
      params.push(`amount=${toHuman(amountAtomic, asset.decimals)}`)
    }
    if (!asset.native) {
      const issuer = asset.reference ?? this.net.usdcIssuer
      params.push(`asset_code=${asset.symbol}`)
      params.push(`asset_issuer=${issuer}`)
    }
    return `web+stellar:pay?${params.join('&')}`
  }

  // ── name resolution (SEP-0002 federation) ─────────────────────────────────

  isName(value: string): boolean {
    return value.includes('*')
  }

  /**
   * Resolve a `name*domain.com` federation address to a `G...` account via the
   * domain's `stellar.toml` FEDERATION_SERVER. If the input is already a valid
   * G-address it is returned unchanged; anything else resolves to null.
   */
  async resolveName(name: string): Promise<string | null> {
    if (StrKey.isValidEd25519PublicKey(name)) return name
    if (!this.isName(name)) return null
    try {
      const record = await Federation.Server.resolve(name)
      return record.account_id ?? null
    } catch {
      return null
    }
  }

  /** Reverse federation lookup is not standardised; not supported. */
  async lookupName(_address: string): Promise<string | null> {
    return null
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private server(): Horizon.Server {
    if (!this._server) {
      this._server = new Horizon.Server(horizonUrlFor(this.net))
    }
    return this._server
  }

  /** True if `address` holds a trustline for the (non-native) asset. */
  private async hasTrustline(
    address: string,
    asset: AssetRef
  ): Promise<boolean> {
    if (asset.native) return true
    try {
      const account = await this.server().loadAccount(address)
      return account.balances.some(
        (b) =>
          'asset_code' in b &&
          b.asset_code === asset.symbol &&
          'asset_issuer' in b &&
          b.asset_issuer === asset.reference
      )
    } catch {
      return false
    }
  }

  /** Poll Horizon until the transaction is found or a short budget elapses. */
  private async waitForTx(hash: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const status = await this.getTxStatus(hash)
      if (status === 'confirmed' || status === 'failed') return
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  /** Pull the most actionable message out of a Horizon submission error. */
  private horizonErrorMessage(err: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (err as any)?.response?.data
    const codes = data?.extras?.result_codes
    if (codes) {
      const ops = Array.isArray(codes.operations)
        ? ` ops=[${codes.operations.join(', ')}]`
        : ''
      return `Stellar transaction failed: ${codes.transaction ?? 'unknown'}${ops}`
    }
    if (data?.title) return `Stellar submission failed: ${data.title}`
    return `Stellar submission failed: ${String(
      err instanceof Error ? err.message : err
    )}`
  }

  private assertStellar(
    secret: ChainSecret
  ): asserts secret is {
    family: 'stellar'
    secret?: string
    seed?: Uint8Array
  } {
    if (secret.family !== 'stellar') {
      throw new PrismError(
        'NO_KEY_FOR_CHAIN',
        `Stellar adapter received a ${secret.family} secret.`
      )
    }
  }
}
