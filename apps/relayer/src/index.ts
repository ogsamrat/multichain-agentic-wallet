import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { logger } from 'hono/logger'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  publicActions
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import type { PaymentRequired } from '@prism/protocol'
import { env } from './config.js'

/**
 * Prism Relayer — an OPTIONAL managed treasury that settles x402 payments on a
 * caller's behalf and exposes a fiat on-ramp link. The wallet stays
 * non-custodial by default; this service is only used when a deployment opts in
 * (PRISM_RELAYER_URL on the wallet side). It holds a single treasury key, not
 * per-user balances.
 */

const NETWORKS = {
  base: {
    chain: base,
    caip2: 'eip155:8453',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
  },
  'base-sepolia': {
    chain: baseSepolia,
    caip2: 'eip155:84532',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
  }
}
const NET = NETWORKS[env.PRISM_RELAYER_NETWORK]

function authorized(c: Context): boolean {
  if (!env.PRISM_ADMIN_SECRET) return true
  return c.req.header('x-prism-admin-secret') === env.PRISM_ADMIN_SECRET
}

const app = new Hono()
app.use('*', logger())

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'prism-relayer',
    network: NET.caip2,
    treasuryConfigured: Boolean(env.PRISM_TREASURY_EVM_KEY)
  })
)

app.post('/api/settle', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)
  if (!env.PRISM_TREASURY_EVM_KEY) {
    return c.json({ error: 'treasury key not configured' }, 503)
  }
  let body: { paymentRequirements?: PaymentRequired }
  try {
    body = (await c.req.json()) as { paymentRequirements?: PaymentRequired }
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  const pr = body.paymentRequirements
  if (!pr?.accepts?.length) {
    return c.json({ error: 'missing paymentRequirements.accepts' }, 400)
  }

  const account = privateKeyToAccount(
    env.PRISM_TREASURY_EVM_KEY as `0x${string}`
  )
  const walletClient = createWalletClient({
    account,
    chain: NET.chain,
    transport: http()
  }).extend(publicActions)
  const signer = Object.assign(walletClient, { address: account.address })

  const client = new x402Client()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerExactEvmScheme(client, { signer: signer as any })
  const httpClient = new x402HTTPClient(client)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = await httpClient.createPaymentPayload(pr as any)
    const headers = httpClient.encodePaymentSignatureHeader(payload)
    const entries = Object.entries(headers)
    if (!entries.length) throw new Error('failed to encode payment header')
    const [headerName, headerValue] = entries[0]
    return c.json({
      success: true,
      headerName,
      headerValue: String(headerValue),
      network: NET.caip2,
      via: 'treasury'
    })
  } catch (err) {
    return c.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      },
      402
    )
  }
})

app.get('/api/treasury', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)
  if (!env.PRISM_TREASURY_EVM_KEY) {
    return c.json({ error: 'treasury key not configured' }, 503)
  }
  const account = privateKeyToAccount(
    env.PRISM_TREASURY_EVM_KEY as `0x${string}`
  )
  const publicClient = createPublicClient({
    chain: NET.chain,
    transport: http()
  })
  const balance = (await publicClient.readContract({
    address: NET.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address]
  })) as bigint
  return c.json({
    address: account.address,
    network: NET.caip2,
    usdc: formatUnits(balance, 6)
  })
})

app.post('/api/onramp', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { amountUsd?: number }
  if (!env.PRISM_ONRAMP_URL) {
    return c.json({
      configured: false,
      note: 'Set PRISM_ONRAMP_URL to enable a fiat on-ramp checkout link.'
    })
  }
  const url = new URL(env.PRISM_ONRAMP_URL)
  if (body.amountUsd) url.searchParams.set('amount', String(body.amountUsd))
  return c.json({ configured: true, url: url.toString() })
})

serve({ fetch: app.fetch, port: env.PORT })
console.log(
  `Prism relayer listening on http://localhost:${env.PORT} (${NET.caip2})`
)
