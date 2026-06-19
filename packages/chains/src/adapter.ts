import type { PaymentAccept, SignedPayment } from '@prism/protocol'
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
} from './types.js'

/**
 * The single interface every chain implements. The base contract covers reads
 * and value transfer; richer behaviour is exposed through capability mixins an
 * adapter opts into. Adding a new chain means writing one `ChainAdapter` and
 * registering it — nothing else in the system changes.
 */
export interface ChainAdapter {
  readonly info: ChainInfo
  readonly capabilities: ReadonlySet<Capability>
  supports(cap: Capability): boolean

  /** Derive the chain's primary address from a family secret. */
  deriveAddress(secret: ChainSecret): Promise<string>

  /** Resolve a symbol/contract/native marker to a concrete asset. */
  resolveAsset(ref: string): Promise<AssetRef | null>

  getNativeBalance(address: string): Promise<Balance>
  getTokenBalances(address: string, assets?: AssetRef[]): Promise<Balance[]>
  getTxStatus(hash: string): Promise<TxStatus>
  explorerUrl(ref: {
    tx?: string
    address?: string
    asset?: string
  }): string | undefined

  estimateFee(intent: TransferIntent, from: string): Promise<FeeEstimate>
  simulate(intent: TransferIntent, from: string): Promise<SimResult>
  send(
    intent: TransferIntent,
    secret: ChainSecret,
    opts?: SendOpts
  ): Promise<TxRef>
}

/** Human-readable name resolution (ENS, SNS, NFD, Stellar federation, ...). */
export interface NameResolving {
  isName(value: string): boolean
  resolveName(name: string): Promise<string | null>
  lookupName(address: string): Promise<string | null>
}

/** Signs an x402 payment authorization for one accepted option. */
export interface X402Capable {
  x402Sign(accept: PaymentAccept, secret: ChainSecret): Promise<SignedPayment>
  /**
   * Build a self-directed `accept` for a manual payment (when there is no
   * server 402 to parse), e.g. the `pay` tool. Optional per adapter.
   */
  x402BuildAccept?(params: {
    asset: AssetRef
    payTo: string
    amountAtomic: bigint
    resource?: string
  }): PaymentAccept
}

/** ERC-20 allowances / ASA opt-in / Stellar trustlines. */
export interface AllowanceManaging {
  getAllowance(owner: string, spender: string, asset: AssetRef): Promise<bigint>
  setAllowance(
    spender: string,
    asset: AssetRef,
    amountAtomic: bigint,
    secret: ChainSecret
  ): Promise<TxRef>
}

export interface SwapQuote {
  assetIn: AssetRef
  assetOut: AssetRef
  amountInAtomic: bigint
  amountOutAtomic: bigint
  minAmountOutAtomic: bigint
  priceImpactPct?: number
  raw?: unknown
}

/** On-chain swaps / DEX routing. */
export interface Swapping {
  quote(req: {
    assetIn: AssetRef
    assetOut: AssetRef
    amountInAtomic: bigint
    slippagePct?: number
  }): Promise<SwapQuote>
  swap(quote: SwapQuote, secret: ChainSecret): Promise<TxRef>
}

export interface TokenSpec {
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  url?: string
}

/** Native token issuance (ASA, SPL mint, ERC-20 deploy). */
export interface TokenIssuing {
  issueToken(
    spec: TokenSpec,
    secret: ChainSecret
  ): Promise<{ asset: AssetRef; tx: TxRef }>
}

/** Arbitrary message signing (EIP-191/712, ed25519, ...). */
export interface MessageSigning {
  signMessage(
    message: string,
    secret: ChainSecret
  ): Promise<{ signature: string; scheme: string }>
}

/** Build a payment-request deep link (EIP-681, BIP-21, solana:, ARC-26, LN). */
export interface FundingUriBuilding {
  buildFundingUri(req: {
    address: string
    asset: AssetRef
    amountAtomic?: bigint
    note?: string
  }): string
}

/** Lightning-style invoicing for non-account-model payment rails. */
export interface Invoicing {
  createInvoice(
    req: { amountAtomic?: bigint; memo?: string; expirySeconds?: number },
    secret: ChainSecret
  ): Promise<{ invoice: string; paymentHash: string }>
  payInvoice(
    invoice: string,
    secret: ChainSecret,
    opts?: { maxFeeAtomic?: bigint }
  ): Promise<{ preimage: string; feeAtomic: bigint }>
  decodeInvoice(
    invoice: string
  ): Promise<{ amountAtomic?: bigint; description?: string; payee?: string }>
}

// ─── Capability type guards ──────────────────────────────────────────────────

export function isNameResolving(
  a: ChainAdapter
): a is ChainAdapter & NameResolving {
  return a.supports('name_resolution')
}
export function isX402Capable(
  a: ChainAdapter
): a is ChainAdapter & X402Capable {
  return a.supports('x402_pay')
}
export function isAllowanceManaging(
  a: ChainAdapter
): a is ChainAdapter & AllowanceManaging {
  return a.supports('allowance')
}
export function isSwapping(a: ChainAdapter): a is ChainAdapter & Swapping {
  return a.supports('swap')
}
export function isTokenIssuing(
  a: ChainAdapter
): a is ChainAdapter & TokenIssuing {
  return a.supports('token_issuance')
}
export function isMessageSigning(
  a: ChainAdapter
): a is ChainAdapter & MessageSigning {
  return a.supports('message_signing')
}
export function isFundingUriBuilding(
  a: ChainAdapter
): a is ChainAdapter & FundingUriBuilding {
  return a.supports('funding_uri')
}
export function isInvoicing(a: ChainAdapter): a is ChainAdapter & Invoicing {
  return a.supports('invoicing')
}
