import { x402Client, x402HTTPClient } from '@x402/core/client'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type {
  PaymentAccept,
  PaymentRequired,
  SignedPayment
} from '@prism/protocol'
import type { EvmNetwork } from './networks.js'
import { rpcOverride } from './networks.js'

/**
 * Sign a single x402 `accept` option on an EVM chain. Produces the encoded
 * payment header (v1 `X-PAYMENT` or v2 `PAYMENT-SIGNATURE`) to attach to the
 * paid request. USDC on EVM is settled via EIP-3009 `transferWithAuthorization`,
 * so no prior approval or gas is required from the payer.
 */
export async function evmX402Sign(
  net: EvmNetwork,
  accept: PaymentAccept,
  privateKey: string
): Promise<SignedPayment> {
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const rpc = rpcOverride(net.chainId)
  const walletClient = createWalletClient({
    account,
    chain: net.viemChain,
    transport: rpc ? http(rpc) : http()
  }).extend(publicActions)

  const signer = Object.assign(walletClient, { address: account.address })

  const client = new x402Client()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerExactEvmScheme(client, { signer: signer as any })
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
