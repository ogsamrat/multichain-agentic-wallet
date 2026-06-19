import { LightningAdapter } from './adapter.js'
import { LIGHTNING_NETWORKS } from './networks.js'

export { LightningAdapter } from './adapter.js'
export { LIGHTNING_NETWORKS } from './networks.js'
export type { LightningNetwork } from './networks.js'

/** Build an adapter for every configured Lightning network. */
export function createLightningAdapters(): LightningAdapter[] {
  return LIGHTNING_NETWORKS.map((net) => new LightningAdapter(net))
}
