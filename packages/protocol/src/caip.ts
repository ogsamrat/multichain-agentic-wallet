/**
 * Chain-agnostic identifiers based on the CAIP standards.
 *
 * - CAIP-2 names a chain:        `eip155:8453`, `solana:5eykt4...`, `stellar:pubnet`
 * - CAIP-19 names an asset:      `eip155:8453/erc20:0x833...`, `solana:.../slip44:501`
 *
 * Keeping every network and asset addressable by a single string lets the rest
 * of the system stay completely chain-agnostic.
 */

/** A CAIP-2 chain identifier, e.g. `eip155:8453`. */
export type Caip2 = `${string}:${string}`

/** A CAIP-19 asset identifier, e.g. `eip155:8453/erc20:0x833...`. */
export type Caip19 = `${Caip2}/${string}`

/**
 * The settlement model a chain follows. Capability detection keys off this so
 * account-model chains and UTXO/Lightning chains can share one interface.
 */
export type ChainFamily =
  | 'evm'
  | 'svm'
  | 'algorand'
  | 'stellar'
  | 'bitcoin'
  | 'lightning'

/** How balances and ownership are modelled on a chain. */
export type AccountModel = 'account' | 'utxo' | 'utxo+ln'

const CAIP2_RE = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/

/** Returns true if `value` is shaped like a CAIP-2 identifier. */
export function isCaip2(value: string): value is Caip2 {
  return CAIP2_RE.test(value)
}

/** Splits a CAIP-2 identifier into its namespace and reference. */
export function parseCaip2(caip2: Caip2): {
  namespace: string
  reference: string
} {
  const idx = caip2.indexOf(':')
  return { namespace: caip2.slice(0, idx), reference: caip2.slice(idx + 1) }
}

/** Builds a CAIP-19 asset id from a chain and an asset path (`erc20:0x...`). */
export function toCaip19(caip2: Caip2, assetPath: string): Caip19 {
  return `${caip2}/${assetPath}`
}

/** Splits a CAIP-19 asset id into its chain and asset path. */
export function parseCaip19(caip19: Caip19): {
  caip2: Caip2
  assetPath: string
} {
  const idx = caip19.indexOf('/')
  return {
    caip2: caip19.slice(0, idx) as Caip2,
    assetPath: caip19.slice(idx + 1)
  }
}
