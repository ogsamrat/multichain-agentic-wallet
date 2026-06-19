import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().default(3100),
  PRISM_TREASURY_EVM_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex key')
    .optional(),
  PRISM_RELAYER_NETWORK: z
    .enum(['base', 'base-sepolia'])
    .default('base-sepolia'),
  PRISM_ADMIN_SECRET: z.string().optional(),
  PRISM_ONRAMP_URL: z.string().url().optional()
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid relayer environment:')
  for (const [field, messages] of Object.entries(
    parsed.error.flatten().fieldErrors
  )) {
    console.error(`  ${field}: ${(messages ?? []).join(', ')}`)
  }
  process.exit(1)
}

export const env = parsed.data
