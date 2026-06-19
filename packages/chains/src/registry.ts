import { UnknownChainError } from '@prism/core'
import type { Caip2 } from '@prism/protocol'
import { isCaip2 } from '@prism/protocol'
import type { ChainAdapter } from './adapter.js'

/**
 * Holds the active chain adapters and resolves a chain by CAIP-2 id or any of
 * its friendly aliases (`base`, `base-sepolia`, ...).
 */
export class AdapterRegistry {
  private readonly byCaip2 = new Map<Caip2, ChainAdapter>()
  private readonly aliasToCaip2 = new Map<string, Caip2>()

  register(adapter: ChainAdapter): this {
    const { caip2, aliases } = adapter.info
    this.byCaip2.set(caip2, adapter)
    this.aliasToCaip2.set(caip2.toLowerCase(), caip2)
    for (const alias of aliases) {
      this.aliasToCaip2.set(alias.toLowerCase(), caip2)
    }
    return this
  }

  registerAll(adapters: ChainAdapter[]): this {
    for (const a of adapters) this.register(a)
    return this
  }

  resolveCaip2(idOrAlias: string): Caip2 | undefined {
    const direct = this.aliasToCaip2.get(idOrAlias.toLowerCase())
    if (direct) return direct
    if (isCaip2(idOrAlias) && this.byCaip2.has(idOrAlias)) return idOrAlias
    return undefined
  }

  get(idOrAlias: string): ChainAdapter | undefined {
    const caip2 = this.resolveCaip2(idOrAlias)
    return caip2 ? this.byCaip2.get(caip2) : undefined
  }

  /** Like {@link get} but throws {@link UnknownChainError} when unknown. */
  require(idOrAlias: string): ChainAdapter {
    const adapter = this.get(idOrAlias)
    if (!adapter) throw new UnknownChainError(idOrAlias)
    return adapter
  }

  has(idOrAlias: string): boolean {
    return this.get(idOrAlias) !== undefined
  }

  list(): ChainAdapter[] {
    return [...this.byCaip2.values()]
  }

  get size(): number {
    return this.byCaip2.size
  }
}
