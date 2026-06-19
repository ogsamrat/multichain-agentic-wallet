import { Networks } from '@stellar/stellar-sdk'
import type { Caip2 } from '@prism/protocol'

/** Static description of one Stellar network Prism can operate on. */
export interface StellarNetwork {
  caip2: Caip2
  displayName: string
  aliases: string[]
  testnet: boolean
  /** Horizon REST endpoint used for reads and submission. */
  horizonUrl: string
  /** Network passphrase mixed into the transaction signature hash. */
  networkPassphrase: string
  /** Circle USDC issuing account on this network. */
  usdcIssuer: string
  /** stellar.expert explorer base for this network. */
  explorerBase: string
}

export const STELLAR_NETWORKS: StellarNetwork[] = [
  {
    caip2: 'stellar:pubnet',
    displayName: 'Stellar',
    aliases: ['stellar', 'xlm'],
    testnet: false,
    horizonUrl: 'https://horizon.stellar.org',
    networkPassphrase: Networks.PUBLIC,
    usdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    explorerBase: 'https://stellar.expert/explorer/public'
  },
  {
    caip2: 'stellar:testnet',
    displayName: 'Stellar Testnet',
    aliases: ['stellar-testnet'],
    testnet: true,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    // Circle's USDC issuer on Stellar testnet. Override via env if it changes.
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    explorerBase: 'https://stellar.expert/explorer/testnet'
  }
]

/** Native XLM has 7 decimals and is addressed by SLIP-44 coin type 148. */
export const XLM_DECIMALS = 7
/** USDC on Stellar uses 7 decimals (Horizon reports all balances to 7dp). */
export const USDC_DECIMALS = 7
/** Stellar asset code for Circle USDC. */
export const USDC_CODE = 'USDC'

/**
 * Per-network Horizon override via env, e.g. `PRISM_STELLAR_HORIZON_PUBNET`.
 * The suffix is the CAIP-2 reference upper-cased (`PUBNET`, `TESTNET`).
 */
export function horizonOverride(net: StellarNetwork): string | undefined {
  const ref = net.caip2.split(':')[1]?.toUpperCase()
  return ref ? process.env[`PRISM_STELLAR_HORIZON_${ref}`] : undefined
}

/** Resolve the Horizon URL for a network, honouring any env override. */
export function horizonUrlFor(net: StellarNetwork): string {
  return horizonOverride(net) ?? net.horizonUrl
}
