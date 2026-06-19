import type { ChainAdapter } from './adapter.js'
import { createEvmAdapters } from './evm/index.js'
import { createAlgorandAdapters } from './algorand/index.js'
import { createStellarAdapters } from './stellar/index.js'
import { createSolanaAdapters } from './solana/index.js'
import { createBitcoinAdapters } from './bitcoin/index.js'
import { createLightningAdapters } from './lightning/index.js'

export * from './types.js'
export * from './adapter.js'
export * from './registry.js'

export { createEvmAdapters, EvmAdapter, EVM_NETWORKS } from './evm/index.js'
export type { EvmNetwork } from './evm/index.js'
export {
  createAlgorandAdapters,
  AlgorandAdapter,
  ALGORAND_NETWORKS
} from './algorand/index.js'
export {
  createStellarAdapters,
  StellarAdapter,
  STELLAR_NETWORKS
} from './stellar/index.js'
export {
  createSolanaAdapters,
  SolanaAdapter,
  SOLANA_NETWORKS
} from './solana/index.js'
export {
  createBitcoinAdapters,
  BitcoinAdapter,
  BITCOIN_NETWORKS
} from './bitcoin/index.js'
export {
  createLightningAdapters,
  LightningAdapter,
  LIGHTNING_NETWORKS
} from './lightning/index.js'

/** Build the default adapter set across every supported chain family. */
export function createDefaultAdapters(): ChainAdapter[] {
  return [
    ...createEvmAdapters(),
    ...createAlgorandAdapters(),
    ...createStellarAdapters(),
    ...createSolanaAdapters(),
    ...createBitcoinAdapters(),
    ...createLightningAdapters()
  ]
}
