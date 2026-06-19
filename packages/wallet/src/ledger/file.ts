import fs from 'node:fs'
import { ensureHome, ledgerPath } from '../keyring/keystore.js'
import { BaseLedger, emptyLedgerData, type LedgerData } from './ledger.js'

/**
 * Ledger persisted as a single JSON file under `$PRISM_HOME`. Simple, durable,
 * and dependency-free — budgets and receipts survive restarts.
 */
export class FileLedger extends BaseLedger {
  protected data: LedgerData

  constructor() {
    super()
    this.data = FileLedger.load()
  }

  private static load(): LedgerData {
    try {
      const raw = fs.readFileSync(ledgerPath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<LedgerData>
      return { ...emptyLedgerData(), ...parsed }
    } catch {
      return emptyLedgerData()
    }
  }

  protected persist(): void {
    ensureHome()
    fs.writeFileSync(ledgerPath(), JSON.stringify(this.data, null, 2) + '\n', {
      mode: 0o600
    })
  }
}
