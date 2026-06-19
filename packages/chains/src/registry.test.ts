import { describe, it, expect } from 'vitest'
import { AdapterRegistry } from '@prism/chains'
import type { ChainAdapter } from '@prism/chains'

function fakeAdapter(caip2: string, aliases: string[]): ChainAdapter {
  return {
    info: {
      caip2: caip2 as `${string}:${string}`,
      family: 'evm',
      accountModel: 'account',
      displayName: caip2,
      aliases,
      testnet: false,
      nativeAsset: {
        caip19: `${caip2}/slip44:60`,
        symbol: 'ETH',
        decimals: 18,
        native: true
      }
    },
    capabilities: new Set(),
    supports: () => false,
    deriveAddress: async () => '0x',
    resolveAsset: async () => null,
    getNativeBalance: async () => {
      throw new Error('unused')
    },
    getTokenBalances: async () => [],
    getTxStatus: async () => 'unknown',
    explorerUrl: () => undefined,
    estimateFee: async () => {
      throw new Error('unused')
    },
    simulate: async () => ({ ok: true, warnings: [] }),
    send: async () => {
      throw new Error('unused')
    }
  }
}

describe('AdapterRegistry', () => {
  it('resolves by CAIP-2 and by alias', () => {
    const reg = new AdapterRegistry()
    reg.register(fakeAdapter('eip155:8453', ['base']))
    expect(reg.get('base')?.info.caip2).toBe('eip155:8453')
    expect(reg.get('eip155:8453')?.info.caip2).toBe('eip155:8453')
    expect(reg.get('BASE')?.info.caip2).toBe('eip155:8453')
  })

  it('throws on unknown chains via require', () => {
    const reg = new AdapterRegistry()
    expect(() => reg.require('nope')).toThrow()
  })

  it('reports size after registering many', () => {
    const reg = new AdapterRegistry()
    reg.registerAll([
      fakeAdapter('eip155:1', ['ethereum']),
      fakeAdapter('eip155:10', ['optimism'])
    ])
    expect(reg.size).toBe(2)
  })
})
