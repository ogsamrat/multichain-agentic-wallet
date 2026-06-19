import type { ChainAdapter, X402Capable } from '@prism/chains'
import { isX402Capable, type AdapterRegistry } from '@prism/chains'
import type { PaymentAccept, PaymentRequired } from '@prism/protocol'
import { acceptAmount } from '@prism/protocol'

export interface NegotiateOpts {
  prefer?: 'cheapest' | 'fastest' | 'preferred-chain'
  preferredChains?: string[]
  maxAmountUsd?: number
}

export interface FulfillableOption {
  accept: PaymentAccept
  adapter: ChainAdapter & X402Capable
  amountUsd: number
}

/** Decimals to assume for a chain's stablecoin (Stellar uses 7, others 6). */
function stableDecimals(caip2: string): number {
  return caip2.startsWith('stellar:') ? 7 : 6
}

/** Rough finality score; higher settles faster. */
function speedScore(adapter: ChainAdapter): number {
  switch (adapter.info.family) {
    case 'svm':
    case 'lightning':
      return 5
    case 'stellar':
      return 5
    case 'algorand':
      return 4
    case 'evm':
      return adapter.info.caip2 === 'eip155:1' ? 1 : 3
    default:
      return 1
  }
}

/**
 * Choose the best payment option the wallet can actually fulfill from a server's
 * `accepts` list, honoring the caller's preference and price ceiling.
 */
export function selectAccept(
  req: PaymentRequired,
  registry: AdapterRegistry,
  canFund: (caip2: string) => boolean,
  opts?: NegotiateOpts
): FulfillableOption | null {
  const candidates: FulfillableOption[] = []

  for (const accept of req.accepts) {
    const adapter = registry.get(accept.network)
    if (!adapter || !isX402Capable(adapter)) continue
    if (!canFund(adapter.info.caip2)) continue

    const atomic = acceptAmount(accept)
    if (!atomic) continue
    const amountUsd =
      Number(BigInt(atomic)) / 10 ** stableDecimals(adapter.info.caip2)
    if (opts?.maxAmountUsd !== undefined && amountUsd > opts.maxAmountUsd)
      continue

    candidates.push({ accept, adapter, amountUsd })
  }

  if (candidates.length === 0) return null

  const prefer = opts?.prefer ?? 'cheapest'
  if (prefer === 'preferred-chain' && opts?.preferredChains?.length) {
    const preferred = candidates.find((c) =>
      opts.preferredChains!.includes(c.adapter.info.caip2)
    )
    if (preferred) return preferred
  }
  if (prefer === 'fastest') {
    return [...candidates].sort(
      (a, b) =>
        speedScore(b.adapter) - speedScore(a.adapter) ||
        a.amountUsd - b.amountUsd
    )[0]
  }
  return [...candidates].sort((a, b) => a.amountUsd - b.amountUsd)[0]
}
