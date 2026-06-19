import { BitcoinAdapter } from './adapter.js'
import { BITCOIN_NETWORKS } from './networks.js'

export { BitcoinAdapter } from './adapter.js'
export { BITCOIN_NETWORKS } from './networks.js'
export type { BitcoinNetwork } from './networks.js'

/** Build an adapter for every configured Bitcoin network. */
export function createBitcoinAdapters(): BitcoinAdapter[] {
  return BITCOIN_NETWORKS.map((net) => new BitcoinAdapter(net))
}
