import { describe, it, expect } from 'vitest'
import { Amount } from '@prism/protocol'

describe('Amount', () => {
  it('parses decimals to atomic units', () => {
    expect(Amount.fromDecimal('1.5', 6).atomic).toBe(1_500_000n)
    expect(Amount.fromDecimal('0.000001', 6).atomic).toBe(1n)
    expect(Amount.fromDecimal('10', 6).atomic).toBe(10_000_000n)
  })

  it('renders atomic units back to a fixed decimal string', () => {
    expect(Amount.fromAtomic(1_500_000n, 6).toDecimal()).toBe('1.500000')
    expect(Amount.fromAtomic(1n, 6).toDecimal()).toBe('0.000001')
    expect(Amount.fromAtomic(0n, 0).toDecimal()).toBe('0')
  })

  it('truncates excess precision instead of rounding', () => {
    expect(Amount.fromDecimal('1.2345678', 6).atomic).toBe(1_234_567n)
  })

  it('adds and subtracts at the same scale', () => {
    const a = Amount.fromDecimal('1.5', 6)
    const b = Amount.fromDecimal('0.25', 6)
    expect(a.add(b).toDecimal()).toBe('1.750000')
    expect(a.sub(b).toDecimal()).toBe('1.250000')
  })

  it('rejects mixing scales', () => {
    expect(() =>
      Amount.fromDecimal('1', 6).add(Amount.fromDecimal('1', 7))
    ).toThrow()
  })

  it('rejects malformed input', () => {
    expect(() => Amount.fromDecimal('abc', 6)).toThrow()
  })
})
