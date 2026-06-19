import { x402Client, x402HTTPClient } from '@x402-avm/core/client'
import { registerExactAvmScheme } from '@x402-avm/avm/exact/client'
import algosdk from 'algosdk'
import type {
  PaymentAccept,
  PaymentRequired,
  SignedPayment
} from '@prism/protocol'
import type { ChainSecret } from '../types.js'
import type { AlgorandNetwork } from './networks.js'

/**
 * Sign a single x402 `accept` option on Algorand. Produces the encoded payment
 * header to attach to the paid request.
 *
 * Algorand settles `exact` payments through the `@x402-avm` pipeline, which
 * builds and signs the underlying ASA/payment transactions (including any
 * fee-payer logic) from a lightweight signer that only exposes `address` and
 * `signTransactions`. The signer is derived from the family secret — either a
 * 25-word mnemonic or a 32-byte seed.
 */
export async function algorandX402Sign(
  net: AlgorandNetwork,
  accept: PaymentAccept,
  secret: Extract<ChainSecret, { family: 'algorand' }>
): Promise<SignedPayment> {
  const { sk, addr } = accountFromSecret(secret)
  const address = algosdk.encodeAddress(addr.publicKey)

  // The ClientAvmSigner interface only needs `address` + `signTransactions`.
  const signer = {
    address,
    signTransactions: async (
      txns: Uint8Array[],
      indexesToSign?: number[]
    ): Promise<(Uint8Array | null)[]> => {
      return txns.map((txnBytes, i) => {
        if (indexesToSign && !indexesToSign.includes(i)) return null
        const decoded = algosdk.decodeUnsignedTransaction(txnBytes)
        return algosdk.signTransaction(decoded, sk).blob
      })
    }
  }

  const client = new x402Client()
  registerExactAvmScheme(client, {
    signer,
    algodConfig: { algodUrl: net.algodUrl }
  })
  const httpClient = new x402HTTPClient(client)

  const paymentRequired: PaymentRequired = { x402Version: 2, accepts: [accept] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = await httpClient.createPaymentPayload(paymentRequired as any)
  const headers = httpClient.encodePaymentSignatureHeader(payload)

  const entries = Object.entries(headers)
  if (entries.length === 0) {
    throw new Error('Failed to generate x402 payment header')
  }
  const [headerName, headerValue] = entries[0]
  return {
    headerName,
    headerValue: String(headerValue),
    scheme: accept.scheme,
    network: accept.network
  }
}

/**
 * Derive an algosdk account `{ addr, sk }` from the family secret. Prefers the
 * mnemonic; otherwise reconstructs the mnemonic from the 32-byte seed.
 */
function accountFromSecret(
  secret: Extract<ChainSecret, { family: 'algorand' }>
): ReturnType<typeof algosdk.mnemonicToSecretKey> {
  if (secret.mnemonic) {
    return algosdk.mnemonicToSecretKey(secret.mnemonic)
  }
  if (secret.seed) {
    const mnemonic = algosdk.mnemonicFromSeed(Buffer.from(secret.seed))
    return algosdk.mnemonicToSecretKey(mnemonic)
  }
  throw new Error('Algorand secret has neither a mnemonic nor a seed.')
}
