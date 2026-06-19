/**
 * x402 protocol shapes.
 *
 * These mirror the HTTP 402 "Payment Required" handshake: a server advertises
 * one or more ways to pay (`accepts`), the client signs one of them, and
 * retries the request with a payment header. The types are scheme-agnostic so a
 * single negotiation engine can serve EVM, Solana, Algorand, and Stellar.
 */

/** A single way a resource server is willing to be paid. */
export interface PaymentAccept {
  /** Settlement scheme, e.g. `exact`. */
  scheme: string
  /** CAIP-2 chain the payment settles on. */
  network: string
  /** Asset identifier (contract address, ASA id, issuer, etc.). */
  asset: string
  /** Destination address. */
  payTo: string
  /** Required amount in atomic units (v2 field). */
  amount?: string
  /** Required amount in atomic units (v1 field). */
  maxAmountRequired?: string
  /** Seconds the signed authorization remains valid. */
  maxTimeoutSeconds?: number
  /** Scheme-specific extra fields (e.g. EIP-712 domain). */
  extra?: Record<string, unknown>
}

/** The body/header a server returns alongside an HTTP 402 response. */
export interface PaymentRequired {
  x402Version: number
  error?: string
  accepts: PaymentAccept[]
  resource?: {
    url?: string
    description?: string
    mimeType?: string
  }
}

/** A signed payment ready to be attached to an HTTP request. */
export interface SignedPayment {
  /** Header name to set (`X-PAYMENT` in v1, `PAYMENT-SIGNATURE` in v2). */
  headerName: string
  /** Encoded header value. */
  headerValue: string
  /** Scheme used to sign. */
  scheme: string
  /** CAIP-2 chain the payment settles on. */
  network: string
}

/** Returns the required atomic amount from an accept (v1/v2 tolerant). */
export function acceptAmount(accept: PaymentAccept): string | undefined {
  return accept.amount ?? accept.maxAmountRequired
}
