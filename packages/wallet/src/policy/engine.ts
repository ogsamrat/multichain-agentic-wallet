import { createHash } from 'node:crypto'
import type { Ledger } from '../ledger/ledger.js'
import { DEFAULT_POLICY, type SpendingPolicy } from './policy.js'

/** A value-moving action submitted for authorization. */
export interface ValueAction {
  kind:
    | 'transfer'
    | 'swap'
    | 'x402'
    | 'allowance'
    | 'token_issue'
    | 'invoice_pay'
  caip2: string
  /**
   * The action's value in USD, or `null` when it cannot be valued (no known
   * price for the asset). A `null` value is treated as "unknown", never as
   * zero — the policy engine fails closed and escalates to confirmation rather
   * than waving an unpriced spend straight past the USD caps.
   */
  amountUsd: number | null
  to?: string
  domain?: string
}

export type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: string }
  | { allow: 'needs_confirmation'; reason: string; token: string }

function host(domainOrUrl?: string): string | undefined {
  if (!domainOrUrl) return undefined
  try {
    return new URL(domainOrUrl).host
  } catch {
    return domainOrUrl
  }
}

/**
 * The single chokepoint every value-moving action passes through. Enforces
 * per-call / per-day caps and allow/deny lists against the durable ledger, and
 * escalates to human confirmation per the autonomy mode.
 */
export class PolicyEngine {
  private readonly approved = new Set<string>()
  /** Whether an autonomous `session` has been opened by a confirmation. */
  private sessionStarted = false

  constructor(private readonly ledger: Ledger) {}

  get policy(): SpendingPolicy {
    return this.ledger.getPolicy() ?? DEFAULT_POLICY
  }

  setPolicy(policy: SpendingPolicy): void {
    this.ledger.setPolicy(policy)
  }

  /** Pre-approve a confirmation token (called by the confirm_action tool). */
  confirm(token: string): void {
    this.approved.add(token)
  }

  /** Whether an autonomous `session` is currently open. */
  get sessionActive(): boolean {
    return this.sessionStarted
  }

  /**
   * End any open autonomous session. Called when the wallet locks, so a
   * re-unlock requires a fresh confirmation before `session` mode spends again.
   */
  endSession(): void {
    this.sessionStarted = false
  }

  authorize(action: ValueAction): PolicyDecision {
    const p = this.policy
    const dHost = host(action.domain)

    if (action.to && p.denyRecipients?.includes(action.to)) {
      return { allow: false, reason: `recipient ${action.to} is denied` }
    }
    if (dHost && p.denyDomains?.includes(dHost)) {
      return { allow: false, reason: `domain ${dHost} is denied` }
    }
    if (
      p.allowRecipients?.length &&
      action.to &&
      !p.allowRecipients.includes(action.to)
    ) {
      return {
        allow: false,
        reason: `recipient ${action.to} is not on the allow-list`
      }
    }
    if (p.allowDomains?.length && dHost && !p.allowDomains.includes(dHost)) {
      return {
        allow: false,
        reason: `domain ${dHost} is not on the allow-list`
      }
    }

    // USD caps can only be enforced when the action has a known dollar value.
    // An unvaluable action (amountUsd === null) is never compared against a cap
    // as if it were $0; instead it escalates to confirmation below.
    const valued = action.amountUsd !== null
    const amountUsd = action.amountUsd ?? 0

    if (valued) {
      const perCall = parseFloat(p.maxPerCallUsd)
      if (amountUsd > perCall) {
        return {
          allow: false,
          reason: `amount $${amountUsd.toFixed(4)} exceeds per-call cap $${p.maxPerCallUsd}`
        }
      }

      const perDay = parseFloat(p.maxPerDayUsd)
      const spentToday = this.ledger.spentTodayUsd()
      if (spentToday + amountUsd > perDay) {
        return {
          allow: false,
          reason: `would exceed daily cap $${p.maxPerDayUsd} (already spent $${spentToday.toFixed(4)})`
        }
      }

      const chainCap = p.perChainPerDayUsd?.[action.caip2]
      if (chainCap !== undefined) {
        const spentChain = this.ledger.spentTodayUsd(action.caip2)
        if (spentChain + amountUsd > parseFloat(chainCap)) {
          return {
            allow: false,
            reason: `would exceed daily cap $${chainCap} for ${action.caip2}`
          }
        }
      }
    }

    // Reasons an action escalates to a human confirmation:
    const overThreshold =
      valued &&
      p.requireConfirmAboveUsd !== undefined &&
      amountUsd > parseFloat(p.requireConfirmAboveUsd)
    // Fail closed: an unpriced spend cannot be proven within the caps.
    const unvaluable = !valued
    // `session` mode runs autonomously, but only after one confirmation opens
    // the session (reset whenever the wallet locks).
    const sessionOpening = p.autonomy === 'session' && !this.sessionStarted

    const needsConfirm =
      p.autonomy === 'human_in_the_loop' ||
      overThreshold ||
      unvaluable ||
      sessionOpening

    if (needsConfirm) {
      const token = this.tokenFor(action)
      if (this.approved.has(token)) {
        this.approved.delete(token)
        if (p.autonomy === 'session') this.sessionStarted = true
        return { allow: true }
      }
      return {
        allow: 'needs_confirmation',
        reason: this.confirmReason(p, { unvaluable, overThreshold }),
        token
      }
    }

    return { allow: true }
  }

  private confirmReason(
    p: SpendingPolicy,
    flags: { unvaluable: boolean; overThreshold: boolean }
  ): string {
    if (p.autonomy === 'human_in_the_loop') {
      return 'human-in-the-loop mode: confirm to proceed'
    }
    if (flags.unvaluable) {
      return 'amount could not be valued in USD (no known price); confirm to proceed'
    }
    if (flags.overThreshold) {
      return `amount exceeds the confirmation threshold of $${p.requireConfirmAboveUsd}`
    }
    return 'session mode: confirm to start an autonomous session'
  }

  private tokenFor(action: ValueAction): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          kind: action.kind,
          caip2: action.caip2,
          amountUsd: action.amountUsd,
          to: action.to ?? null,
          domain: host(action.domain) ?? null
        })
      )
      .digest('hex')
      .slice(0, 16)
  }
}
