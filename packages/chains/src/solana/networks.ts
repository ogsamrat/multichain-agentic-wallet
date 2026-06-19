import type { Caip2 } from '@prism/protocol'

/** Static description of one Solana (SVM) network Prism can operate on. */
export interface SolanaNetwork {
  caip2: Caip2
  displayName: string
  aliases: string[]
  testnet: boolean
  rpcUrl: string
  /** Native SOL symbol/decimals are fixed for the SVM family. */
  nativeSymbol: string
  nativeDecimals: number
  /** Canonical USDC mint on this cluster. */
  usdcMint: string
  usdcDecimals: number
  /** Explorer base URL (no cluster query). */
  explorer: string
  /**
   * Cluster name appended to explorer URLs as `?cluster=<name>`. Empty string
   * for mainnet-beta (Solana Explorer treats no cluster as mainnet).
   */
  explorerCluster: string
}

export const SOLANA_NETWORKS: SolanaNetwork[] = [
  {
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    displayName: 'Solana',
    aliases: ['solana', 'sol'],
    testnet: false,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    nativeSymbol: 'SOL',
    nativeDecimals: 9,
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    usdcDecimals: 6,
    explorer: 'https://explorer.solana.com',
    explorerCluster: ''
  },
  {
    caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    displayName: 'Solana Devnet',
    aliases: ['solana-devnet', 'sol-devnet'],
    testnet: true,
    rpcUrl: 'https://api.devnet.solana.com',
    nativeSymbol: 'SOL',
    nativeDecimals: 9,
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    usdcDecimals: 6,
    explorer: 'https://explorer.solana.com',
    explorerCluster: 'devnet'
  }
]

/**
 * Per-network RPC override via env, keyed by the CAIP-2 reference (the part
 * after `solana:`), e.g. `PRISM_SOLANA_RPC_5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`.
 * Mirrors EVM's `rpcOverride`.
 */
export function rpcOverride(caip2: Caip2): string | undefined {
  const reference = caip2.includes(':') ? caip2.split(':')[1] : caip2
  return process.env[`PRISM_SOLANA_RPC_${reference}`]
}
