/**
 * Exact decimal money math.
 *
 * Every amount is stored as an integer count of the asset's smallest unit
 * (`atomic`) together with its `decimals`. Decimal strings are only ever used
 * at the human/agent boundary — never for arithmetic — which removes the
 * floating-point and copy-pasted `10 ** 6` bugs that plague naive wallets.
 */
export class Amount {
  readonly atomic: bigint
  readonly decimals: number

  constructor(atomic: bigint, decimals: number) {
    if (decimals < 0 || !Number.isInteger(decimals)) {
      throw new Error(`Invalid decimals: ${decimals}`)
    }
    this.atomic = atomic
    this.decimals = decimals
  }

  /** Parse a decimal string ("1.50") into an Amount with `decimals` precision. */
  static fromDecimal(value: string, decimals: number): Amount {
    const trimmed = value.trim()
    if (!/^-?\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
      throw new Error(`Invalid decimal amount: "${value}"`)
    }
    const negative = trimmed.startsWith('-')
    const unsigned = negative ? trimmed.slice(1) : trimmed
    const [wholePart = '0', fracPart = ''] = unsigned.split('.')
    const frac = fracPart.padEnd(decimals, '0').slice(0, decimals)
    const whole = wholePart === '' ? '0' : wholePart
    const atomic =
      BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac === '' ? '0' : frac)
    return new Amount(negative ? -atomic : atomic, decimals)
  }

  /** Construct directly from atomic units. */
  static fromAtomic(
    atomic: bigint | string | number,
    decimals: number
  ): Amount {
    return new Amount(BigInt(atomic), decimals)
  }

  /** Render as a fixed-precision decimal string ("1.500000"). */
  toDecimal(): string {
    const negative = this.atomic < 0n
    const abs = negative ? -this.atomic : this.atomic
    const base = 10n ** BigInt(this.decimals)
    const whole = abs / base
    const frac = abs % base
    const sign = negative ? '-' : ''
    if (this.decimals === 0) return `${sign}${whole}`
    return `${sign}${whole}.${frac.toString().padStart(this.decimals, '0')}`
  }

  add(other: Amount): Amount {
    this.assertSameScale(other)
    return new Amount(this.atomic + other.atomic, this.decimals)
  }

  sub(other: Amount): Amount {
    this.assertSameScale(other)
    return new Amount(this.atomic - other.atomic, this.decimals)
  }

  gt(other: Amount): boolean {
    this.assertSameScale(other)
    return this.atomic > other.atomic
  }

  gte(other: Amount): boolean {
    this.assertSameScale(other)
    return this.atomic >= other.atomic
  }

  isZero(): boolean {
    return this.atomic === 0n
  }

  isNegative(): boolean {
    return this.atomic < 0n
  }

  /** Approximate this amount as a JS number (for ranking/USD math only). */
  toNumber(): number {
    return Number(this.atomic) / 10 ** this.decimals
  }

  private assertSameScale(other: Amount): void {
    if (other.decimals !== this.decimals) {
      throw new Error(
        `Cannot combine amounts with different decimals (${this.decimals} vs ${other.decimals})`
      )
    }
  }
}
