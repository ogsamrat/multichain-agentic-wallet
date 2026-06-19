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
  amountUsd: number
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

    const perCall = parseFloat(p.maxPerCallUsd)
    if (action.amountUsd > perCall) {
      return {
        allow: false,
        reason: `amount $${action.amountUsd.toFixed(4)} exceeds per-call cap $${p.maxPerCallUsd}`
      }
    }

    const perDay = parseFloat(p.maxPerDayUsd)
    const spentToday = this.ledger.spentTodayUsd()
    if (spentToday + action.amountUsd > perDay) {
      return {
        allow: false,
        reason: `would exceed daily cap $${p.maxPerDayUsd} (already spent $${spentToday.toFixed(4)})`
      }
    }

    const chainCap = p.perChainPerDayUsd?.[action.caip2]
    if (chainCap !== undefined) {
      const spentChain = this.ledger.spentTodayUsd(action.caip2)
      if (spentChain + action.amountUsd > parseFloat(chainCap)) {
        return {
          allow: false,
          reason: `would exceed daily cap $${chainCap} for ${action.caip2}`
        }
      }
    }

    const needsConfirm =
      p.autonomy === 'human_in_the_loop' ||
      (p.requireConfirmAboveUsd !== undefined &&
        action.amountUsd > parseFloat(p.requireConfirmAboveUsd))

    if (needsConfirm) {
      const token = this.tokenFor(action)
      if (this.approved.has(token)) {
        this.approved.delete(token)
        return { allow: true }
      }
      return {
        allow: 'needs_confirmation',
        reason:
          p.autonomy === 'human_in_the_loop'
            ? 'human-in-the-loop mode: confirm to proceed'
            : `amount exceeds the confirmation threshold of $${p.requireConfirmAboveUsd}`,
        token
      }
    }

    return { allow: true }
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
