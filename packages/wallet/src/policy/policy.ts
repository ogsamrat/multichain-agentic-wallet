/** How much autonomy the agent has over spending. */
export type AutonomyMode = 'full_autonomous' | 'session' | 'human_in_the_loop'

/** A user-controlled spending policy. All caps are USD decimal strings. */
export interface SpendingPolicy {
  autonomy: AutonomyMode
  maxPerCallUsd: string
  maxPerDayUsd: string
  /** Optional tighter per-chain daily caps, keyed by CAIP-2. */
  perChainPerDayUsd?: Record<string, string>
  /** If set, only these recipient addresses are allowed. */
  allowRecipients?: string[]
  denyRecipients?: string[]
  /** If set, only these resource domains may be paid via x402. */
  allowDomains?: string[]
  denyDomains?: string[]
  /** Spends above this USD amount require explicit confirmation. */
  requireConfirmAboveUsd?: string
}

export const DEFAULT_POLICY: SpendingPolicy = {
  autonomy: 'full_autonomous',
  maxPerCallUsd: '0.10',
  maxPerDayUsd: '20.00'
}
