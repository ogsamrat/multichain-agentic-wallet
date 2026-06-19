import type { Caip2 } from '@prism/protocol'

/**
 * A network parameter set used by `@scure/btc-signer` to encode addresses and
 * WIF keys. Matches the shape that library's payment/WIF helpers expect.
 */
export interface BitcoinChainParams {
  bech32: string
  pubKeyHash: number
  scriptHash: number
  wif: number
}

/** Static description of one Bitcoin network Prism can operate on. */
export interface BitcoinNetwork {
  caip2: Caip2
  displayName: string
  aliases: string[]
  testnet: boolean
  /** Esplora REST base, e.g. `https://blockstream.info/api`. */
  esploraUrl: string
  /** Block explorer web base, e.g. `https://blockstream.info`. */
  explorer: string
  nativeSymbol: string
  nativeDecimals: number
  /** Bech32 human-readable part for native segwit addresses (`bc` / `tb`). */
  bech32Hrp: string
  /** Network params for `@scure/btc-signer` address/WIF coders. */
  params: BitcoinChainParams
}

export const BITCOIN_NETWORKS: BitcoinNetwork[] = [
  {
    caip2: 'bip122:000000000019d6689c085ae165831e93',
    displayName: 'Bitcoin',
    aliases: ['bitcoin', 'btc'],
    testnet: false,
    esploraUrl: 'https://blockstream.info/api',
    explorer: 'https://blockstream.info',
    nativeSymbol: 'BTC',
    nativeDecimals: 8,
    bech32Hrp: 'bc',
    params: {
      bech32: 'bc',
      pubKeyHash: 0x00,
      scriptHash: 0x05,
      wif: 0x80
    }
  },
  {
    caip2: 'bip122:000000000933ea01ad0ee984209779ba',
    displayName: 'Bitcoin Testnet',
    aliases: ['bitcoin-testnet', 'btc-testnet'],
    testnet: true,
    esploraUrl: 'https://blockstream.info/testnet/api',
    explorer: 'https://blockstream.info/testnet',
    nativeSymbol: 'BTC',
    nativeDecimals: 8,
    bech32Hrp: 'tb',
    params: {
      bech32: 'tb',
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef
    }
  }
]
