import { SolanaAdapter } from './adapter.js'
import { SOLANA_NETWORKS } from './networks.js'

export { SolanaAdapter } from './adapter.js'
export { SOLANA_NETWORKS, rpcOverride } from './networks.js'
export type { SolanaNetwork } from './networks.js'

/** Build an adapter for every configured Solana network. */
export function createSolanaAdapters(): SolanaAdapter[] {
  return SOLANA_NETWORKS.map((net) => new SolanaAdapter(net))
}
