import type { AccountModel, Caip2, Caip19, ChainFamily } from '@prism/protocol'

/**
 * A capability an adapter may implement. The agent inspects an adapter's
 * capability set to know what each chain can actually do, so account-model and
 * UTXO/Lightning chains can coexist behind one interface.
 */
export type Capability =
  | 'native_transfer'
  | 'token_transfer'
  | 'token_balance'
  | 'name_resolution'
  | 'x402_pay'
  | 'swap'
  | 'token_issuance'
  | 'allowance'
  | 'message_signing'
  | 'funding_uri'
  | 'invoicing'

/** A fungible asset addressable by CAIP-19. */
export interface AssetRef {
  caip19: Caip19
  symbol: string
  decimals: number
  native: boolean
  name?: string
  /** Chain-native reference (contract address, ASA id, issuer, mint, ...). */
  reference?: string
}

/** A balance of a single asset, in atomic units plus a human string. */
export interface Balance {
  asset: AssetRef
  atomic: bigint
  human: string
}

/** Static description of a chain an adapter serves. */
export interface ChainInfo {
  caip2: Caip2
  family: ChainFamily
  accountModel: AccountModel
  displayName: string
  /** Friendly aliases accepted in tool input, e.g. `base`, `base-sepolia`. */
  aliases: string[]
  nativeAsset: AssetRef
  testnet: boolean
}

export type FeeTier = 'slow' | 'normal' | 'fast'

/** A request to move value on a chain. */
export interface TransferIntent {
  asset: AssetRef
  to: string
  amountAtomic: bigint
  memo?: string
  feeTier?: FeeTier
}

export interface FeeEstimate {
  asset: AssetRef
  atomic: bigint
  human: string
  tier?: FeeTier
}

export interface TxRef {
  hash: string
  caip2: Caip2
  explorerUrl?: string
}

export type TxStatus = 'pending' | 'confirmed' | 'failed' | 'unknown'

export interface SendOpts {
  waitForConfirmation?: boolean
}

export interface SimResult {
  ok: boolean
  fee?: FeeEstimate
  warnings: string[]
  detail?: Record<string, unknown>
}

/**
 * The chain-native secret the keyring hands to an adapter for an authorized
 * action. Adapters only ever receive the derived secret for their own family —
 * never the master seed or other chains' keys.
 */
export type ChainSecret =
  | { family: 'evm'; privateKey: string }
  | { family: 'svm'; secretKey?: Uint8Array; seed?: Uint8Array }
  | { family: 'algorand'; mnemonic?: string; seed?: Uint8Array }
  | { family: 'stellar'; secret?: string; seed?: Uint8Array }
  | { family: 'bitcoin'; wif?: string; seed?: Uint8Array }
  | { family: 'lightning'; connect: string }
