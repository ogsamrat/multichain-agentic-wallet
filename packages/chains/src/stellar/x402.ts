import { x402Client, x402HTTPClient } from '@x402/core/client'
import { ExactStellarScheme, createEd25519Signer } from '@x402/stellar'
import { PrismError } from '@prism/core'
import type {
  PaymentAccept,
  PaymentRequired,
  SignedPayment
} from '@prism/protocol'
import type { ChainSecret } from '../types.js'
import type { StellarNetwork } from './networks.js'

/**
 * Derive the Stellar ed25519 signer the x402 client uses to authorize a
 * payment. The installed `@x402/stellar` (v2.8.0) exposes `createEd25519Signer`,
 * which only accepts a classic `S...` secret seed — there is no seed-bytes
 * factory — so a raw seed is first turned into a `Keypair` and encoded as a
 * secret. Done lazily to keep `@stellar/stellar-sdk` off the import critical
 * path for callers that never sign.
 */
async function stellarSigner(secret: ChainSecret) {
  if (secret.family !== 'stellar') {
    throw new PrismError(
      'NO_KEY_FOR_CHAIN',
      `Stellar adapter received a ${secret.family} secret.`
    )
  }
  let secretSeed = secret.secret
  if (!secretSeed) {
    if (!secret.seed) {
      throw new PrismError('NO_KEY_FOR_CHAIN', 'Stellar secret has no key.')
    }
    const { Keypair } = await import('@stellar/stellar-sdk')
    secretSeed = Keypair.fromRawEd25519Seed(Buffer.from(secret.seed)).secret()
  }
  return createEd25519Signer(secretSeed)
}

/**
 * Sign a single x402 `accept` option on Stellar and produce the encoded payment
 * header to attach to the paid request.
 *
 * The v2.8.0 `@x402/stellar` package exposes the `ExactStellarScheme` class
 * (constructed from an ed25519 signer) rather than a `registerExactStellarScheme`
 * helper. It is registered on the generic `@x402/core` `x402Client` against the
 * payment's CAIP-2 network via `client.register(network, scheme)`, mirroring the
 * EVM adapter's use of `registerExactEvmScheme`. The HTTP client then builds the
 * payload from a one-option `PaymentRequired` and encodes the header; we take the
 * first emitted header entry (`PAYMENT-SIGNATURE` for v2).
 */
export async function stellarX402Sign(
  net: StellarNetwork,
  accept: PaymentAccept,
  secret: ChainSecret
): Promise<SignedPayment> {
  const signer = await stellarSigner(secret)
  const scheme = new ExactStellarScheme(signer)

  const client = new x402Client()
  // The accept's network is the CAIP-2 the scheme settles on; fall back to the
  // adapter's network when a caller hands us a bare accept.
  const network = (accept.network || net.caip2) as `${string}:${string}`
  client.register(network, scheme)
  const httpClient = new x402HTTPClient(client)

  const paymentRequired: PaymentRequired = { x402Version: 2, accepts: [accept] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = await httpClient.createPaymentPayload(paymentRequired as any)
  const headers = httpClient.encodePaymentSignatureHeader(payload)

  const entries = Object.entries(headers)
  if (entries.length === 0) {
    throw new PrismError(
      'PAYMENT_FAILED',
      'Failed to generate Stellar x402 payment header.'
    )
  }
  const [headerName, headerValue] = entries[0]
  return {
    headerName,
    headerValue: String(headerValue),
    scheme: accept.scheme,
    network
  }
}
