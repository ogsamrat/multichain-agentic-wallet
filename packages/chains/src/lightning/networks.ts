import type { Caip2 } from '@prism/protocol'

/**
 * Static description of the Lightning rail. Lightning has no canonical CAIP-2
 * namespace, so `lightning:bolt11` is used as a stable internal marker.
 */
export interface LightningNetwork {
  caip2: Caip2
  displayName: string
  aliases: string[]
  testnet: boolean
  nativeSymbol: string
  nativeDecimals: number
}

export const LIGHTNING_NETWORKS: LightningNetwork[] = [
  {
    caip2: 'lightning:bolt11',
    displayName: 'Lightning',
    aliases: ['lightning', 'ln'],
    testnet: false,
    nativeSymbol: 'sats',
    nativeDecimals: 0
  }
]
