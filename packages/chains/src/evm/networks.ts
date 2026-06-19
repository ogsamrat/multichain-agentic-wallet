import type { Chain } from 'viem'
import {
  arbitrum,
  avalanche,
  base,
  baseSepolia,
  mainnet,
  optimism,
  polygon,
  sepolia
} from 'viem/chains'
import type { Caip2 } from '@prism/protocol'

/** Static description of one EVM network Prism can operate on. */
export interface EvmNetwork {
  caip2: Caip2
  chainId: number
  displayName: string
  aliases: string[]
  testnet: boolean
  nativeSymbol: string
  nativeDecimals: number
  explorerBase: string
  viemChain: Chain
  usdc?: { address: `0x${string}`; decimals: number }
  /** USDC EIP-712 domain, used when building a payment from scratch. */
  usdcEip712?: { name: string; version: string }
}

export const EVM_NETWORKS: EvmNetwork[] = [
  {
    caip2: 'eip155:8453',
    chainId: 8453,
    displayName: 'Base',
    aliases: ['base'],
    testnet: false,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorerBase: 'https://basescan.org',
    viemChain: base,
    usdc: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6
    },
    usdcEip712: { name: 'USD Coin', version: '2' }
  },
  {
    caip2: 'eip155:84532',
    chainId: 84532,
    displayName: 'Base Sepolia',
    aliases: ['base-sepolia', 'basesepolia'],
    testnet: true,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorerBase: 'https://sepolia.basescan.org',
    viemChain: baseSepolia,
    usdc: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: 6
    },
    usdcEip712: { name: 'USDC', version: '2' }
  },
  {
    caip2: 'eip155:1',
    chainId: 1,
    displayName: 'Ethereum',
    aliases: ['ethereum', 'eth', 'mainnet'],
    testnet: false,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorerBase: 'https://etherscan.io',
    viemChain: mainnet,
    usdc: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6
    },
    usdcEip712: { name: 'USD Coin', version: '2' }
  },
  {
    caip2: 'eip155:42161',
    chainId: 42161,
    displayName: 'Arbitrum One',
    aliases: ['arbitrum', 'arb'],
    testnet: false,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorerBase: 'https://arbiscan.io',
    viemChain: arbitrum,
    usdc: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 }
  },
  {
    caip2: 'eip155:10',
    chainId: 10,
    displayName: 'OP Mainnet',
    aliases: ['optimism', 'op'],
    testnet: false,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorerBase: 'https://optimistic.etherscan.io',
    viemChain: optimism,
    usdc: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 }
  },
  {
    caip2: 'eip155:137',
    chainId: 137,
    displayName: 'Polygon',
    aliases: ['polygon', 'matic'],
    testnet: false,
    nativeSymbol: 'POL',
    nativeDecimals: 18,
    explorerBase: 'https://polygonscan.com',
    viemChain: polygon,
    usdc: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 }
  },
  {
    caip2: 'eip155:43114',
    chainId: 43114,
    displayName: 'Avalanche C-Chain',
    aliases: ['avalanche', 'avax'],
    testnet: false,
    nativeSymbol: 'AVAX',
    nativeDecimals: 18,
    explorerBase: 'https://snowtrace.io',
    viemChain: avalanche,
    usdc: { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 }
  },
  {
    caip2: 'eip155:11155111',
    chainId: 11155111,
    displayName: 'Sepolia',
    aliases: ['sepolia', 'eth-sepolia'],
    testnet: true,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    explorerBase: 'https://sepolia.etherscan.io',
    viemChain: sepolia,
    usdc: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 }
  }
]

/** Per-chain RPC override via env, e.g. `PRISM_EVM_RPC_8453`. */
export function rpcOverride(chainId: number): string | undefined {
  return process.env[`PRISM_EVM_RPC_${chainId}`]
}
