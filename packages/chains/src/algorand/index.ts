import { AlgorandAdapter } from './adapter.js'
import { ALGORAND_NETWORKS } from './networks.js'

export { AlgorandAdapter } from './adapter.js'
export { ALGORAND_NETWORKS } from './networks.js'
export type { AlgorandNetwork } from './networks.js'

/** Build an adapter for every configured Algorand network. */
export function createAlgorandAdapters(): AlgorandAdapter[] {
  return ALGORAND_NETWORKS.map((net) => new AlgorandAdapter(net))
}
