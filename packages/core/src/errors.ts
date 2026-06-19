/** Stable error codes surfaced to callers and agents. */
export type PrismErrorCode =
  | 'KEYRING_LOCKED'
  | 'NO_KEY_FOR_CHAIN'
  | 'UNKNOWN_CHAIN'
  | 'UNSUPPORTED_CAPABILITY'
  | 'POLICY_DENIED'
  | 'NEEDS_CONFIRMATION'
  | 'INSUFFICIENT_FUNDS'
  | 'PAYMENT_FAILED'
  | 'NO_FULFILLABLE_PAYMENT'
  | 'CONFIG_ERROR'
  | 'NAME_RESOLUTION_FAILED'
  | 'INTERNAL'

/** Base class for every error Prism raises. Carries a machine-readable code. */
export class PrismError extends Error {
  readonly code: PrismErrorCode
  readonly details?: Record<string, unknown>

  constructor(
    code: PrismErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'PrismError'
    this.code = code
    this.details = details
  }
}

export class KeyringLockedError extends PrismError {
  constructor() {
    super('KEYRING_LOCKED', 'Wallet is locked. Unlock it before signing.')
    this.name = 'KeyringLockedError'
  }
}

export class NoKeyForChainError extends PrismError {
  constructor(chain: string) {
    super('NO_KEY_FOR_CHAIN', `No key configured for chain "${chain}".`, {
      chain
    })
    this.name = 'NoKeyForChainError'
  }
}

export class UnknownChainError extends PrismError {
  constructor(chain: string) {
    super('UNKNOWN_CHAIN', `Unknown or unsupported chain "${chain}".`, {
      chain
    })
    this.name = 'UnknownChainError'
  }
}

export class UnsupportedCapabilityError extends PrismError {
  constructor(capability: string, chain: string) {
    super(
      'UNSUPPORTED_CAPABILITY',
      `Chain "${chain}" does not support "${capability}".`,
      { capability, chain }
    )
    this.name = 'UnsupportedCapabilityError'
  }
}

export class PolicyDeniedError extends PrismError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super(
      'POLICY_DENIED',
      `Spending policy denied this action: ${reason}`,
      details
    )
    this.name = 'PolicyDeniedError'
  }
}

export class InsufficientFundsError extends PrismError {
  constructor(have: string, need: string, asset: string) {
    super(
      'INSUFFICIENT_FUNDS',
      `Insufficient ${asset}: have ${have}, need ${need}.`,
      { have, need, asset }
    )
    this.name = 'InsufficientFundsError'
  }
}

export class NoFulfillablePaymentError extends PrismError {
  constructor(offered: string[]) {
    super(
      'NO_FULFILLABLE_PAYMENT',
      `Cannot fulfill payment. Server accepts [${offered.join(', ')}] but the wallet is not configured for any of them.`,
      { offered }
    )
    this.name = 'NoFulfillablePaymentError'
  }
}

export class ConfigError extends PrismError {
  constructor(message: string) {
    super('CONFIG_ERROR', message)
    this.name = 'ConfigError'
  }
}

/** Normalize any thrown value into a readable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
