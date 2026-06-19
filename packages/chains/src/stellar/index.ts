import { StellarAdapter } from './adapter.js'
import { STELLAR_NETWORKS } from './networks.js'

export { StellarAdapter } from './adapter.js'
export { STELLAR_NETWORKS, horizonOverride, horizonUrlFor } from './networks.js'
export type { StellarNetwork } from './networks.js'
export { stellarX402Sign } from './x402.js'

/** Build an adapter for every configured Stellar network. */
export function createStellarAdapters(): StellarAdapter[] {
  return STELLAR_NETWORKS.map((net) => new StellarAdapter(net))
}
