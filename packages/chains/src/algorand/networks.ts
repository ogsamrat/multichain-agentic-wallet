import type { Caip2 } from '@prism/protocol'

/** Static description of one Algorand network Prism can operate on. */
export interface AlgorandNetwork {
  caip2: Caip2
  displayName: string
  aliases: string[]
  testnet: boolean
  /** algod REST endpoint (broadcasts txns, reads accounts/assets). */
  algodUrl: string
  /** indexer REST endpoint (historical lookups, tx status, reverse names). */
  indexerUrl: string
  /** Native ALGO unit symbol. */
  nativeSymbol: string
  /** Native ALGO decimals (microAlgos → ALGO is 6dp). */
  nativeDecimals: number
  /** USDC Algorand Standard Asset id for this network. */
  usdcAsaId: number
  /** Pera Wallet explorer base URL. */
  explorerBase: string
}

export const ALGORAND_NETWORKS: AlgorandNetwork[] = [
  {
    caip2: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
    displayName: 'Algorand',
    aliases: ['algorand', 'algo'],
    testnet: false,
    algodUrl: 'https://mainnet-api.algonode.cloud',
    indexerUrl: 'https://mainnet-idx.algonode.cloud',
    nativeSymbol: 'ALGO',
    nativeDecimals: 6,
    usdcAsaId: 31566704,
    explorerBase: 'https://explorer.perawallet.app'
  },
  {
    caip2: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
    displayName: 'Algorand Testnet',
    aliases: ['algorand-testnet', 'algo-testnet'],
    testnet: true,
    algodUrl: 'https://testnet-api.algonode.cloud',
    indexerUrl: 'https://testnet-idx.algonode.cloud',
    nativeSymbol: 'ALGO',
    nativeDecimals: 6,
    usdcAsaId: 10458941,
    explorerBase: 'https://testnet.explorer.perawallet.app'
  }
]
