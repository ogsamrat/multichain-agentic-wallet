import { z } from 'zod'

// Lenient parse with a safe default payTo so the demo seller boots anywhere
// (including serverless) without configuration. Override SELLER_PAY_TO to
// actually receive funds.
const schema = z.object({
  PORT: z.coerce.number().default(4021),
  SELLER_PAY_TO: z
    .string()
    .default('0x000000000000000000000000000000000000dEaD'),
  SELLER_PRICE_USD: z.string().default('0.01'),
  PUBLIC_BASE_URL: z.string().optional(),
  FACILITATOR_URL: z.string().default('https://x402.org/facilitator')
})

const parsed = schema.safeParse(process.env)
export const env = parsed.success ? parsed.data : schema.parse({})

/** CAIP-2 for Base Sepolia, the testnet this demo settles on. */
export const SETTLEMENT_NETWORK = 'eip155:84532' as const
