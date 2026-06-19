import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().default(4021),
  SELLER_PAY_TO: z.string().min(1, 'SELLER_PAY_TO is required'),
  SELLER_PRICE_USD: z.string().default('0.01'),
  PUBLIC_BASE_URL: z.string().url().optional(),
  FACILITATOR_URL: z.string().url().default('https://x402.org/facilitator')
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment for the example seller:')
  for (const [field, messages] of Object.entries(
    parsed.error.flatten().fieldErrors
  )) {
    console.error(`  ${field}: ${(messages ?? []).join(', ')}`)
  }
  process.exit(1)
}

export const env = parsed.data

/** CAIP-2 for Base Sepolia, the testnet this demo settles on. */
export const SETTLEMENT_NETWORK = 'eip155:84532' as const
