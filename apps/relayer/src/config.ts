import { z } from 'zod'

// Lenient parse: every field is optional/defaulted so the app boots in any
// environment (including serverless) without crashing. Missing/invalid values
// just disable the affected feature (e.g. no treasury key -> /settle returns 503).
const schema = z.object({
  PORT: z.coerce.number().default(3100),
  PRISM_TREASURY_EVM_KEY: z.string().optional(),
  PRISM_RELAYER_NETWORK: z
    .enum(['base', 'base-sepolia'])
    .default('base-sepolia'),
  PRISM_ADMIN_SECRET: z.string().optional(),
  PRISM_ONRAMP_URL: z.string().optional()
})

const parsed = schema.safeParse(process.env)
export const env = parsed.success ? parsed.data : schema.parse({})
