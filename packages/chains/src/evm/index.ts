import { EvmAdapter } from './adapter.js'
import { EVM_NETWORKS } from './networks.js'

export { EvmAdapter } from './adapter.js'
export { EVM_NETWORKS, rpcOverride } from './networks.js'
export type { EvmNetwork } from './networks.js'

/** Build an adapter for every configured EVM network. */
export function createEvmAdapters(): EvmAdapter[] {
  return EVM_NETWORKS.map((net) => new EvmAdapter(net))
}
