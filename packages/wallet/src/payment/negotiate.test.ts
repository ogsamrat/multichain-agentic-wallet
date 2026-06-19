import { describe, it, expect } from 'vitest'
import { AdapterRegistry } from '@prism/chains'
import type { ChainAdapter, X402Capable } from '@prism/chains'
import { selectAccept } from '@prism/wallet'
import type { PaymentRequired } from '@prism/protocol'

function x402Adapter(caip2: string): ChainAdapter & X402Capable {
  return {
    info: {
      caip2: caip2 as `${string}:${string}`,
      family: 'evm',
      accountModel: 'account',
      displayName: caip2,
      aliases: [caip2],
      testnet: false,
      nativeAsset: {
        caip19: `${caip2}/slip44:60`,
        symbol: 'ETH',
        decimals: 18,
        native: true
      }
    },
    capabilities: new Set(['x402_pay']),
    supports: (c) => c === 'x402_pay',
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
    },
    x402Sign: async () => ({
      headerName: 'X-PAYMENT',
      headerValue: 'sig',
      scheme: 'exact',
      network: caip2
    })
  }
}

const req: PaymentRequired = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:1',
      asset: 'USDC',
      payTo: '0xa',
      amount: '2000000'
    },
    {
      scheme: 'exact',
      network: 'eip155:8453',
      asset: 'USDC',
      payTo: '0xb',
      amount: '1000000'
    }
  ]
}

describe('selectAccept', () => {
  const reg = new AdapterRegistry()
  reg.register(x402Adapter('eip155:1'))
  reg.register(x402Adapter('eip155:8453'))

  it('picks the cheapest fulfillable option by default', () => {
    const chosen = selectAccept(req, reg, () => true)
    expect(chosen?.adapter.info.caip2).toBe('eip155:8453')
    expect(chosen?.amountUsd).toBe(1)
  })

  it('prefers faster chains when asked', () => {
    const chosen = selectAccept(req, reg, () => true, { prefer: 'fastest' })
    // Base (L2) settles faster than Ethereum mainnet
    expect(chosen?.adapter.info.caip2).toBe('eip155:8453')
  })

  it('skips options the wallet cannot fund', () => {
    const chosen = selectAccept(req, reg, (c) => c === 'eip155:1')
    expect(chosen?.adapter.info.caip2).toBe('eip155:1')
  })

  it('returns null when nothing is fulfillable', () => {
    expect(selectAccept(req, reg, () => false)).toBeNull()
  })

  it('respects a max amount ceiling', () => {
    const chosen = selectAccept(req, reg, () => true, { maxAmountUsd: 1.5 })
    expect(chosen?.amountUsd).toBe(1)
  })
})
