import type { SpendingPolicy } from '../policy/policy.js'

/** An immutable record of one value-moving action. */
export interface SpendEntry {
  id: string
  ts: string
  kind: string
  caip2: string
  assetCaip19?: string
  amountAtomic: string
  /** USD value, or `null` when the asset has no known price. */
  amountUsd: number | null
  to?: string
  domain?: string
  txHash?: string
  status: 'recorded' | 'failed'
}

/** A record of one x402 payment authorization. */
export interface ReceiptEntry {
  id: string
  ts: string
  resourceUrl?: string
  caip2: string
  scheme: string
  assetCaip19?: string
  amountAtomic: string
  /** USD value, or `null` when the asset has no known price. */
  amountUsd: number | null
  payTo: string
  headerName: string
  status: 'signed' | 'settled' | 'failed'
}

/**
 * Durable record of spending, receipts, policy, and idempotency keys. Unlike a
 * volatile in-memory tracker, budgets persist across restarts.
 */
export interface Ledger {
  recordSpend(entry: Omit<SpendEntry, 'id' | 'ts'>): SpendEntry
  spentTodayUsd(caip2?: string): number
  recentSpends(limit?: number): SpendEntry[]

  recordReceipt(entry: Omit<ReceiptEntry, 'id' | 'ts'>): ReceiptEntry
  recentReceipts(limit?: number): ReceiptEntry[]

  hasCorrelation(id: string): boolean
  putCorrelation(id: string): void

  getPolicy(): SpendingPolicy | null
  setPolicy(policy: SpendingPolicy): void
}

const MS_DAY_KEY = (iso: string): string => iso.slice(0, 10)

export interface LedgerData {
  spends: SpendEntry[]
  receipts: ReceiptEntry[]
  correlations: string[]
  policy: SpendingPolicy | null
}

export function emptyLedgerData(): LedgerData {
  return { spends: [], receipts: [], correlations: [], policy: null }
}

/** Shared logic over a {@link LedgerData} blob; subclasses persist it. */
export abstract class BaseLedger implements Ledger {
  protected abstract data: LedgerData
  protected abstract persist(): void

  private newId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  }

  recordSpend(entry: Omit<SpendEntry, 'id' | 'ts'>): SpendEntry {
    const full: SpendEntry = {
      ...entry,
      id: this.newId(),
      ts: new Date().toISOString()
    }
    this.data.spends.push(full)
    this.persist()
    return full
  }

  spentTodayUsd(caip2?: string): number {
    const today = MS_DAY_KEY(new Date().toISOString())
    return this.data.spends
      .filter((s) => s.status !== 'failed' && MS_DAY_KEY(s.ts) === today)
      .filter((s) => (caip2 ? s.caip2 === caip2 : true))
      .reduce((sum, s) => sum + (s.amountUsd ?? 0), 0)
  }

  recentSpends(limit = 20): SpendEntry[] {
    return this.data.spends.slice(-limit).reverse()
  }

  recordReceipt(entry: Omit<ReceiptEntry, 'id' | 'ts'>): ReceiptEntry {
    const full: ReceiptEntry = {
      ...entry,
      id: this.newId(),
      ts: new Date().toISOString()
    }
    this.data.receipts.push(full)
    this.persist()
    return full
  }

  recentReceipts(limit = 20): ReceiptEntry[] {
    return this.data.receipts.slice(-limit).reverse()
  }

  hasCorrelation(id: string): boolean {
    return this.data.correlations.includes(id)
  }

  putCorrelation(id: string): void {
    if (!this.data.correlations.includes(id)) {
      this.data.correlations.push(id)
      this.persist()
    }
  }

  getPolicy(): SpendingPolicy | null {
    return this.data.policy
  }

  setPolicy(policy: SpendingPolicy): void {
    this.data.policy = policy
    this.persist()
  }
}

/** Volatile ledger for tests and ephemeral sessions. */
export class MemoryLedger extends BaseLedger {
  protected data: LedgerData = emptyLedgerData()
  protected persist(): void {
    /* nothing to do */
  }
}
