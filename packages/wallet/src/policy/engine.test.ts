import { describe, it, expect } from 'vitest'
import { MemoryLedger, PolicyEngine } from '@prism/wallet'

function engine(overrides = {}) {
  const ledger = new MemoryLedger()
  ledger.setPolicy({
    autonomy: 'full_autonomous',
    maxPerCallUsd: '1.00',
    maxPerDayUsd: '5.00',
    ...overrides
  })
  return { ledger, eng: new PolicyEngine(ledger) }
}

describe('PolicyEngine', () => {
  it('allows spends within caps', () => {
    const { eng } = engine()
    expect(
      eng.authorize({ kind: 'x402', caip2: 'eip155:8453', amountUsd: 0.5 })
    ).toEqual({
      allow: true
    })
  })

  it('denies spends over the per-call cap', () => {
    const { eng } = engine()
    const d = eng.authorize({
      kind: 'x402',
      caip2: 'eip155:8453',
      amountUsd: 2
    })
    expect(d.allow).toBe(false)
  })

  it('denies spends that would exceed the daily cap', () => {
    const { eng, ledger } = engine()
    ledger.recordSpend({
      kind: 'x402',
      caip2: 'eip155:8453',
      amountAtomic: '0',
      amountUsd: 4.9,
      status: 'recorded'
    })
    const d = eng.authorize({
      kind: 'x402',
      caip2: 'eip155:8453',
      amountUsd: 0.5
    })
    expect(d.allow).toBe(false)
  })

  it('enforces deny and allow lists', () => {
    const { eng } = engine({ denyRecipients: ['0xbad'] })
    expect(
      eng.authorize({
        kind: 'transfer',
        caip2: 'c',
        amountUsd: 0.1,
        to: '0xbad'
      }).allow
    ).toBe(false)
  })

  it('escalates to confirmation in human-in-the-loop mode, then allows after confirm', () => {
    const { eng } = engine({ autonomy: 'human_in_the_loop' })
    const action = {
      kind: 'x402' as const,
      caip2: 'eip155:8453',
      amountUsd: 0.5
    }
    const first = eng.authorize(action)
    expect(first.allow).toBe('needs_confirmation')
    if (first.allow !== 'needs_confirmation')
      throw new Error('expected confirmation')
    eng.confirm(first.token)
    expect(eng.authorize(action)).toEqual({ allow: true })
  })
})
