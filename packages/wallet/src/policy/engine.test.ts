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

  it('fails closed on an unvaluable amount even in full_autonomous, then allows after confirm', () => {
    const { eng } = engine() // full_autonomous
    const action = {
      kind: 'transfer' as const,
      caip2: 'eip155:8453',
      amountUsd: null,
      to: '0xabc'
    }
    const first = eng.authorize(action)
    expect(first.allow).toBe('needs_confirmation')
    if (first.allow !== 'needs_confirmation')
      throw new Error('expected confirmation')
    expect(first.reason).toMatch(/could not be valued/i)
    eng.confirm(first.token)
    expect(eng.authorize(action)).toEqual({ allow: true })
  })

  it('does not count unvaluable spends toward the daily total', () => {
    const { eng, ledger } = engine()
    ledger.recordSpend({
      kind: 'transfer',
      caip2: 'eip155:8453',
      amountAtomic: '1',
      amountUsd: null,
      status: 'recorded'
    })
    expect(ledger.spentTodayUsd()).toBe(0)
    expect(
      eng.authorize({ kind: 'x402', caip2: 'eip155:8453', amountUsd: 0.5 })
    ).toEqual({ allow: true })
  })

  it('session mode opens after one confirmation, then spends within caps autonomously', () => {
    const { eng } = engine({ autonomy: 'session' })
    const open = {
      kind: 'x402' as const,
      caip2: 'eip155:8453',
      amountUsd: 0.5
    }
    const first = eng.authorize(open)
    expect(first.allow).toBe('needs_confirmation')
    if (first.allow !== 'needs_confirmation')
      throw new Error('expected confirmation')
    expect(first.reason).toMatch(/session/i)
    eng.confirm(first.token)
    // confirming opens the session and allows the action
    expect(eng.authorize(open)).toEqual({ allow: true })
    expect(eng.sessionActive).toBe(true)
    // a different action now proceeds without confirmation
    const next = {
      kind: 'transfer' as const,
      caip2: 'eip155:8453',
      amountUsd: 0.3,
      to: '0xabc'
    }
    expect(eng.authorize(next)).toEqual({ allow: true })
    // ending the session re-requires confirmation
    eng.endSession()
    expect(eng.sessionActive).toBe(false)
    expect(eng.authorize(next).allow).toBe('needs_confirmation')
  })

  it('still enforces caps and over-threshold confirmation during an open session', () => {
    const { eng } = engine({ autonomy: 'session', requireConfirmAboveUsd: '0.50' })
    const open = { kind: 'x402' as const, caip2: 'eip155:8453', amountUsd: 0.1 }
    const first = eng.authorize(open)
    if (first.allow !== 'needs_confirmation')
      throw new Error('expected confirmation')
    eng.confirm(first.token)
    expect(eng.authorize(open)).toEqual({ allow: true })
    // session is open, but a spend over the per-call cap is still denied
    expect(
      eng.authorize({ kind: 'x402', caip2: 'eip155:8453', amountUsd: 2 }).allow
    ).toBe(false)
    // and a spend over the confirmation threshold still needs confirmation
    expect(
      eng.authorize({ kind: 'x402', caip2: 'eip155:8453', amountUsd: 0.75 })
        .allow
    ).toBe('needs_confirmation')
  })
})
