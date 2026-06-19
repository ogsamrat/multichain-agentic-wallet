import algosdk from 'algosdk'
import { PrismError } from '@prism/core'
import type { PaymentAccept, SignedPayment } from '@prism/protocol'
import type {
  AllowanceManaging,
  ChainAdapter,
  FundingUriBuilding,
  MessageSigning,
  NameResolving,
  TokenIssuing,
  TokenSpec,
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
import type { AlgorandNetwork } from './networks.js'
import { algorandX402Sign } from './x402.js'

const CAPS: Capability[] = [
  'native_transfer',
  'token_transfer',
  'token_balance',
  'x402_pay',
  'name_resolution',
  'allowance',
  'token_issuance',
  'message_signing',
  'funding_uri'
]

/** The Algorand protocol minimum flat fee, in microAlgos. */
const MIN_FEE = 1000n

type AlgorandSecret = Extract<ChainSecret, { family: 'algorand' }>
type AlgorandAccount = ReturnType<typeof algosdk.mnemonicToSecretKey>

/** One adapter instance serves one Algorand network. */
export class AlgorandAdapter
  implements
    ChainAdapter,
    NameResolving,
    X402Capable,
    AllowanceManaging,
    TokenIssuing,
    MessageSigning,
    FundingUriBuilding
{
  readonly info: ChainInfo
  readonly capabilities: ReadonlySet<Capability> = new Set(CAPS)

  private readonly net: AlgorandNetwork
  private readonly nameResolver: AlgorandNameResolver
  private _algod?: algosdk.Algodv2
  private _indexer?: algosdk.Indexer

  constructor(net: AlgorandNetwork) {
    this.net = net
    this.nameResolver = new AlgorandNameResolver()
    this.info = {
      caip2: net.caip2,
      family: 'algorand',
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

  async deriveAddress(secret: ChainSecret): Promise<string> {
    this.assertAlgorand(secret)
    const { addr } = this.account(secret)
    return algosdk.encodeAddress(addr.publicKey)
  }

  /** Build an algosdk account `{ addr, sk }` from a mnemonic or 32-byte seed. */
  private account(secret: AlgorandSecret): AlgorandAccount {
    if (secret.mnemonic) {
      return algosdk.mnemonicToSecretKey(secret.mnemonic)
    }
    if (secret.seed) {
      const mnemonic = algosdk.mnemonicFromSeed(Buffer.from(secret.seed))
      return algosdk.mnemonicToSecretKey(mnemonic)
    }
    throw new PrismError(
      'NO_KEY_FOR_CHAIN',
      'Algorand secret has neither a mnemonic nor a seed.'
    )
  }

  // ── assets ───────────────────────────────────────────────────────────────

  private nativeAsset(): AssetRef {
    return {
      caip19: `${this.net.caip2}/slip44:283`,
      symbol: this.net.nativeSymbol,
      decimals: this.net.nativeDecimals,
      native: true
    }
  }

  private usdcAsset(): AssetRef {
    return {
      caip19: `${this.net.caip2}/asa:${this.net.usdcAsaId}`,
      symbol: 'USDC',
      decimals: 6,
      native: false,
      reference: String(this.net.usdcAsaId)
    }
  }

  async resolveAsset(ref: string): Promise<AssetRef | null> {
    const lower = ref.trim().toLowerCase()
    if (
      lower === 'native' ||
      lower === 'algo' ||
      lower === this.net.nativeSymbol.toLowerCase()
    ) {
      return this.nativeAsset()
    }
    if (lower === 'usdc') return this.usdcAsset()
    // A bare numeric string is an Algorand Standard Asset (ASA) id.
    if (/^\d+$/.test(lower)) {
      const asaId = Number(lower)
      if (asaId === this.net.usdcAsaId) return this.usdcAsset()
      try {
        const asset = await this.algod().getAssetByID(asaId).do()
        const params = asset.params
        return {
          caip19: `${this.net.caip2}/asa:${asaId}`,
          symbol: params.unitName ?? String(asaId),
          decimals: Number(params.decimals),
          native: false,
          name: params.name,
          reference: String(asaId)
        }
      } catch {
        return null
      }
    }
    return null
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  async getNativeBalance(address: string): Promise<Balance> {
    const info = await this.algod().accountInformation(address).do()
    const atomic = BigInt(info.amount)
    const asset = this.nativeAsset()
    return { asset, atomic, human: formatUnits(atomic, asset.decimals) }
  }

  async getTokenBalances(
    address: string,
    assets?: AssetRef[]
  ): Promise<Balance[]> {
    const list = assets ?? [this.usdcAsset()]
    const info = await this.algod().accountInformation(address).do()
    const holdings = info.assets ?? []
    const balances: Balance[] = []
    for (const asset of list) {
      if (!asset.reference) continue
      const asaId = BigInt(asset.reference)
      const holding = holdings.find((h) => BigInt(h.assetId) === asaId)
      const atomic = holding ? BigInt(holding.amount) : 0n
      balances.push({
        asset,
        atomic,
        human: formatUnits(atomic, asset.decimals)
      })
    }
    return balances
  }

  async getTxStatus(hash: string): Promise<TxStatus> {
    try {
      // The indexer only returns a transaction once it has been committed.
      await this.indexer().lookupTransactionByID(hash).do()
      return 'confirmed'
    } catch {
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
    if (ref.address) return `${base}/address/${ref.address}`
    if (ref.asset) return `${base}/asset/${ref.asset}`
    return undefined
  }

  // ── fee / simulate ───────────────────────────────────────────────────────

  async estimateFee(intent: TransferIntent): Promise<FeeEstimate> {
    // Algorand uses a flat minimum fee per transaction, charged in ALGO.
    const native = this.nativeAsset()
    return {
      asset: native,
      atomic: MIN_FEE,
      human: formatUnits(MIN_FEE, native.decimals),
      tier: intent.feeTier ?? 'normal'
    }
  }

  async simulate(intent: TransferIntent, from: string): Promise<SimResult> {
    const warnings: string[] = []
    const fee = await this.estimateFee(intent)
    try {
      const native = await this.getNativeBalance(from)
      if (intent.asset.native) {
        if (native.atomic < intent.amountAtomic + fee.atomic) {
          warnings.push('ALGO balance may not cover amount plus fee.')
        }
      } else {
        if (native.atomic < fee.atomic) {
          warnings.push('ALGO balance may not cover the fee for this transfer.')
        }
        const [bal] = await this.getTokenBalances(from, [intent.asset])
        if (!bal || bal.atomic < intent.amountAtomic) {
          warnings.push('Token balance may be insufficient or not opted-in.')
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
    this.assertAlgorand(secret)
    const { sk, addr } = this.account(secret)
    const sender = algosdk.encodeAddress(addr.publicKey)
    const algod = this.algod()
    const suggestedParams = await algod.getTransactionParams().do()
    const note = intent.memo ? new TextEncoder().encode(intent.memo) : undefined

    let txn: algosdk.Transaction
    if (intent.asset.native) {
      txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender,
        receiver: intent.to,
        amount: intent.amountAtomic,
        suggestedParams,
        note
      })
    } else {
      if (!intent.asset.reference) {
        throw new PrismError('INTERNAL', 'Token asset missing ASA id.')
      }
      txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender,
        receiver: intent.to,
        amount: intent.amountAtomic,
        assetIndex: Number(intent.asset.reference),
        suggestedParams,
        note
      })
    }

    const signed = algosdk.signTransaction(txn, sk)
    const { txid } = await algod.sendRawTransaction(signed.blob).do()

    if (opts?.waitForConfirmation) {
      await algosdk.waitForConfirmation(algod, txid, 5)
    }
    return {
      hash: txid,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: txid })
    }
  }

  // ── x402 ─────────────────────────────────────────────────────────────────

  async x402Sign(
    accept: PaymentAccept,
    secret: ChainSecret
  ): Promise<SignedPayment> {
    this.assertAlgorand(secret)
    return algorandX402Sign(this.net, accept, secret)
  }

  x402BuildAccept(params: {
    asset: AssetRef
    payTo: string
    amountAtomic: bigint
    resource?: string
  }): PaymentAccept {
    return {
      scheme: 'exact',
      network: this.net.caip2,
      asset: params.asset.reference ?? params.asset.symbol,
      payTo: params.payTo,
      amount: String(params.amountAtomic),
      maxTimeoutSeconds: 300,
      extra: {}
    }
  }

  // ── allowances (ASA opt-in) ────────────────────────────────────────────────

  /**
   * Algorand has no allowance primitive. The closest analogue is the ASA
   * opt-in: an account must opt into an asset before it can hold or receive it.
   * We model "allowance" as opt-in state, so the returned value is always `0n`
   * (there is no spender-scoped, partial approval to report). The `spender`
   * argument is ignored.
   */
  async getAllowance(
    _owner: string,
    _spender: string,
    _asset: AssetRef
  ): Promise<bigint> {
    return 0n
  }

  /**
   * Models an ERC-20 `approve` as an Algorand ASA opt-in. The standard opt-in
   * is a 0-amount asset transfer from the account to itself, which registers
   * the holding. `spender` and `amountAtomic` are ignored — opt-in is binary.
   */
  async setAllowance(
    _spender: string,
    asset: AssetRef,
    _amountAtomic: bigint,
    secret: ChainSecret
  ): Promise<TxRef> {
    this.assertAlgorand(secret)
    if (!asset.reference) {
      throw new PrismError('INTERNAL', 'Token asset missing ASA id.')
    }
    const { sk, addr } = this.account(secret)
    const self = algosdk.encodeAddress(addr.publicKey)
    const algod = this.algod()
    const suggestedParams = await algod.getTransactionParams().do()
    // Opt-in: a 0-amount ASA transfer to self.
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: self,
      receiver: self,
      amount: 0n,
      assetIndex: Number(asset.reference),
      suggestedParams
    })
    const signed = algosdk.signTransaction(txn, sk)
    const { txid } = await algod.sendRawTransaction(signed.blob).do()
    return {
      hash: txid,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: txid })
    }
  }

  // ── token issuance (ASA create) ────────────────────────────────────────────

  async issueToken(
    spec: TokenSpec,
    secret: ChainSecret
  ): Promise<{ asset: AssetRef; tx: TxRef }> {
    this.assertAlgorand(secret)
    const { sk, addr } = this.account(secret)
    const creator = algosdk.encodeAddress(addr.publicKey)
    const algod = this.algod()
    const suggestedParams = await algod.getTransactionParams().do()

    const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
      sender: creator,
      total: spec.totalSupply,
      decimals: spec.decimals,
      defaultFrozen: false,
      assetName: spec.name,
      unitName: spec.symbol,
      assetURL: spec.url,
      // Give the creator manager + reserve roles so they can update/destroy it.
      manager: creator,
      reserve: creator,
      freeze: undefined,
      clawback: undefined,
      suggestedParams
    })

    const signed = algosdk.signTransaction(txn, sk)
    const { txid } = await algod.sendRawTransaction(signed.blob).do()
    const confirmation = await algosdk.waitForConfirmation(algod, txid, 5)
    const asaId = Number(confirmation.assetIndex ?? 0)

    const asset: AssetRef = {
      caip19: `${this.net.caip2}/asa:${asaId}`,
      symbol: spec.symbol,
      decimals: spec.decimals,
      native: false,
      name: spec.name,
      reference: String(asaId)
    }
    const tx: TxRef = {
      hash: txid,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: txid })
    }
    return { asset, tx }
  }

  // ── message signing (ed25519) ──────────────────────────────────────────────

  async signMessage(
    message: string,
    secret: ChainSecret
  ): Promise<{ signature: string; scheme: string }> {
    this.assertAlgorand(secret)
    const { sk } = this.account(secret)
    const bytes = new TextEncoder().encode(message)
    const signature = algosdk.signBytes(bytes, sk)
    return {
      signature: Buffer.from(signature).toString('base64'),
      scheme: 'ed25519'
    }
  }

  // ── funding URI (ARC-26) ────────────────────────────────────────────────────

  buildFundingUri(req: {
    address: string
    asset: AssetRef
    amountAtomic?: bigint
  }): string {
    const { address, asset, amountAtomic } = req
    const micro = amountAtomic !== undefined ? amountAtomic.toString() : '0'
    const assetParam = asset.native ? '' : `&asset=${asset.reference}`
    return `algorand://${address}?amount=${micro}${assetParam}`
  }

  // ── name resolution (.algo / .nfd) ──────────────────────────────────────────

  isName(value: string): boolean {
    return this.nameResolver.isName(value)
  }

  async resolveName(name: string): Promise<string | null> {
    return this.nameResolver.resolve(name)
  }

  async lookupName(address: string): Promise<string | null> {
    return this.nameResolver.lookup(address)
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private algod(): algosdk.Algodv2 {
    if (!this._algod) {
      this._algod = new algosdk.Algodv2('', this.net.algodUrl, '')
    }
    return this._algod
  }

  private indexer(): algosdk.Indexer {
    if (!this._indexer) {
      this._indexer = new algosdk.Indexer('', this.net.indexerUrl, '')
    }
    return this._indexer
  }

  private assertAlgorand(
    secret: ChainSecret
  ): asserts secret is AlgorandSecret {
    if (secret.family !== 'algorand') {
      throw new PrismError(
        'NO_KEY_FOR_CHAIN',
        `Algorand adapter received a ${secret.family} secret.`
      )
    }
  }
}

/**
 * Resolver for human-readable Algorand names (the `.algo` and `.nfd` TLDs),
 * backed by the public Algorand name-service API. Forward resolution maps a
 * name to its verified deposit address; reverse lookup is best-effort.
 */
class AlgorandNameResolver {
  private static readonly API = 'https://api.nf.domains'

  /** True if the value ends with a supported Algorand name TLD. */
  isName(value: string): boolean {
    const lower = value.trim().toLowerCase()
    return lower.endsWith('.algo') || lower.endsWith('.nfd')
  }

  /**
   * Resolve a name to its deposit address. Prefers the verified deposit
   * address (`caAlgo`) and falls back to the registered owner. Returns `null`
   * if the name does not exist or the API is unreachable.
   */
  async resolve(name: string): Promise<string | null> {
    try {
      const lower = name.trim().toLowerCase()
      const url = `${AlgorandNameResolver.API}/nfd/${encodeURIComponent(lower)}?view=brief`
      const res = await fetch(url)
      if (!res.ok) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any
      const address: string | undefined = data.caAlgo?.[0] ?? data.owner
      return address ?? null
    } catch {
      return null
    }
  }

  /**
   * Best-effort reverse lookup: returns the primary name associated with an
   * address, or `null` if none is registered or the API is unreachable.
   */
  async lookup(address: string): Promise<string | null> {
    try {
      const url = `${AlgorandNameResolver.API}/nfd/lookup?address=${encodeURIComponent(address)}&view=brief`
      const res = await fetch(url)
      if (!res.ok) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any
      const entry = data?.[address]
      const name: string | undefined = entry?.name
      return name ?? null
    } catch {
      return null
    }
  }
}

/** Convert an atomic (micro-unit) amount to a human decimal string. */
function formatUnits(atomic: bigint, decimals: number): string {
  if (decimals === 0) return atomic.toString()
  const negative = atomic < 0n
  const abs = negative ? -atomic : atomic
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = (abs % base)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '')
  const sign = negative ? '-' : ''
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`
}
