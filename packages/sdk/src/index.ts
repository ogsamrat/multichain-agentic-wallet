/**
 * `@prism/sdk` — the programmatic entrypoint. Embed a full multichain agentic
 * wallet in any app:
 *
 * ```ts
 * import { createWallet } from '@prism/sdk'
 * const wallet = createWallet()
 * const balances = await wallet.getBalances('base')
 * const res = await wallet.x402Fetch('https://api.example.com/paid')
 * ```
 */
export { createWallet, Wallet } from '@prism/wallet'
export type { CreateWalletOptions } from '@prism/wallet'
export * from '@prism/protocol'
export {
  AdapterRegistry,
  createEvmAdapters,
  type ChainAdapter
} from '@prism/chains'
