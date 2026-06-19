import { keystoreExists } from './keyring/keystore.js'
import type { KeyMaterial } from './keyring/keyring.js'
import type { AutonomyMode, SpendingPolicy } from './policy/policy.js'

export interface PrismRuntimeConfig {
  env: KeyMaterial
  hasEnvKey: boolean
  hasKeystore: boolean
  defaultNetwork: string
  policyFromEnv: Partial<SpendingPolicy>
  indexUrl?: string
  relayerUrl?: string
}

const AUTONOMY_MODES: AutonomyMode[] = [
  'full_autonomous',
  'session',
  'human_in_the_loop'
]

/** Resolve runtime configuration from `PRISM_*` environment variables. */
export function resolveConfig(): PrismRuntimeConfig {
  const env: KeyMaterial = {
    mnemonic: process.env.PRISM_SEED,
    evmPrivateKey: process.env.PRISM_EVM_PRIVATE_KEY,
    solanaSecretKey: process.env.PRISM_SOLANA_SECRET_KEY,
    algorandMnemonic: process.env.PRISM_ALGORAND_MNEMONIC,
    stellarSecret: process.env.PRISM_STELLAR_SECRET,
    bitcoin: process.env.PRISM_BTC_WIF,
    lightning: process.env.PRISM_LN_CONNECT
  }
  const hasEnvKey = Object.values(env).some(
    (v) => typeof v === 'string' && v.length > 0
  )

  const policyFromEnv: Partial<SpendingPolicy> = {}
  if (process.env.PRISM_MAX_PER_CALL)
    policyFromEnv.maxPerCallUsd = process.env.PRISM_MAX_PER_CALL
  if (process.env.PRISM_MAX_PER_DAY)
    policyFromEnv.maxPerDayUsd = process.env.PRISM_MAX_PER_DAY
  const autonomy = process.env.PRISM_AUTONOMY as AutonomyMode | undefined
  if (autonomy && AUTONOMY_MODES.includes(autonomy))
    policyFromEnv.autonomy = autonomy

  return {
    env,
    hasEnvKey,
    hasKeystore: keystoreExists(),
    defaultNetwork: process.env.PRISM_NETWORK ?? 'base-sepolia',
    policyFromEnv,
    // Defaults to the hosted Prism Index so discovery works out of the box.
    indexUrl: process.env.PRISM_INDEX_URL ?? 'https://prism-index.vercel.app',
    relayerUrl: process.env.PRISM_RELAYER_URL
  }
}
