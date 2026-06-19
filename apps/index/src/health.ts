/**
 * The health engine: the beating heart of "a listing exists only while it
 * provably works".
 *
 * On each pass it selects listings whose `nextCheckAt` is due, probes each with
 * the protocol's real handshake, records the run, refreshes the live payment
 * options, then runs a hysteresis state machine that promotes/demotes/auto-
 * delists the listing and reschedules the next check with an adaptive interval.
 */
import { probe } from './probers/index.js'
import type { ProbeResult } from './probers/index.js'
import { latencyPercentiles, reliabilityScore, uptime30d } from './scoring.js'
import type { Store } from './store/store.js'
import type {
  CheckOutcome,
  Listing,
  ListingStatus,
  PaymentOption,
  VerificationRun
} from './types.js'

/** Promotion/demotion thresholds (consecutive runs). */
const PROMOTE_AFTER_PASSES = 2
const DEMOTE_AFTER_FAILS = 2
const DELIST_AFTER_FAILS = 5

/** Adaptive base intervals (seconds) keyed by resulting status. */
const INTERVAL_S: Record<
  'healthy' | 'degraded' | 'unhealthy' | 'delisted',
  number
> = {
  healthy: 300,
  degraded: 120,
  unhealthy: 60,
  delisted: 21_600 // 6h — keep checking in case it comes back
}

export interface RunHealthChecksOptions {
  /** Override "now" (useful for tests/scheduled invocations). */
  now?: Date
  /** Cap how many due listings to process in one pass. */
  limit?: number
  /** Treat the runs as preflight/scheduled/manual (defaults to scheduled). */
  checkKind?: VerificationRun['checkKind']
}

export interface HealthSummary {
  checked: number
  healthy: number
  delisted: number
}

/** Generates a fresh id (crypto.randomUUID where available). */
function genId(prefix = 'vr'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/** A run's outcome counts as "up" if it passed or was merely degraded. */
function isUp(outcome: CheckOutcome): boolean {
  return outcome === 'pass' || outcome === 'degraded'
}

/** Adds a small deterministic jitter (via index) to avoid thundering herds. */
function nextCheckAt(
  now: Date,
  intervalS: number,
  index: number
): {
  iso: string
  intervalS: number
} {
  // Spread checks: +/- up to ~10% of the interval, stepped by listing index.
  const jitter = (index % 11) - 5 // -5..+5
  const seconds = Math.max(15, Math.round(intervalS * (1 + jitter / 100)))
  return {
    iso: new Date(now.getTime() + seconds * 1000).toISOString(),
    intervalS: seconds
  }
}

/**
 * Runs the full state machine for one listing given a fresh probe result.
 * Returns the patch to persist and whether the listing is now healthy/delisted.
 */
function transition(
  listing: Listing,
  result: ProbeResult,
  runs: VerificationRun[],
  hasActivePaymentOption: boolean,
  now: Date,
  index: number
): { patch: Partial<Listing>; healthy: boolean; delisted: boolean } {
  const up = isUp(result.outcome)
  const consecutivePass = up ? listing.consecutivePass + 1 : 0
  const consecutiveFails = up ? 0 : listing.consecutiveFails + 1

  let status: ListingStatus = listing.status
  let enteredUnhealthyAt = listing.enteredUnhealthyAt

  if (up) {
    if (result.outcome === 'degraded') {
      // Degraded stays discoverable, but flagged.
      status = 'degraded'
    } else if (consecutivePass >= PROMOTE_AFTER_PASSES) {
      status = 'healthy'
    } else if (status !== 'healthy') {
      // First pass after trouble: provisional until the second confirms.
      status = 'degraded'
    }
    enteredUnhealthyAt = undefined
  } else {
    if (consecutiveFails >= DELIST_AFTER_FAILS) {
      status = 'delisted'
    } else if (consecutiveFails >= DEMOTE_AFTER_FAILS) {
      status = 'unhealthy'
      enteredUnhealthyAt = enteredUnhealthyAt ?? now.toISOString()
    } else if (status === 'healthy') {
      // One miss from healthy: degrade but keep serving until the 2nd fail.
      status = 'degraded'
    }
  }

  // Score + rollups from the freshest evidence (this run already recorded).
  const score = reliabilityScore(listing, runs, [], now)
  const up30 = uptime30d(runs, now)
  const { p50, p95 } = latencyPercentiles(runs.slice(0, 20))

  // verifiedWorking is the strict, agent-facing guarantee.
  const verifiedWorking =
    up &&
    consecutiveFails === 0 &&
    status !== 'delisted' &&
    hasActivePaymentOption

  const base =
    INTERVAL_S[
      status === 'healthy'
        ? 'healthy'
        : status === 'delisted'
          ? 'delisted'
          : status === 'unhealthy'
            ? 'unhealthy'
            : 'degraded'
    ]
  const sched = nextCheckAt(now, base, index)

  const patch: Partial<Listing> = {
    status,
    verifiedWorking,
    consecutivePass,
    consecutiveFails,
    reliabilityScore: score,
    uptime30d: up30,
    p50LatencyMs: p50 ?? listing.p50LatencyMs,
    p95LatencyMs: p95 ?? listing.p95LatencyMs,
    lastVerifiedAt: up ? now.toISOString() : listing.lastVerifiedAt,
    nextCheckAt: sched.iso,
    checkIntervalS: sched.intervalS,
    enteredUnhealthyAt,
    updatedAt: now.toISOString()
  }

  return {
    patch,
    healthy: status === 'healthy',
    delisted: status === 'delisted'
  }
}

/**
 * Selects due listings, probes each, records the run, refreshes payment
 * options, and applies the health state machine. Returns a summary so callers
 * (HTTP admin route, cron, setInterval) can log a one-liner.
 */
export async function runHealthChecks(
  store: Store,
  opts: RunHealthChecksOptions = {}
): Promise<HealthSummary> {
  const now = opts.now ?? new Date()
  const checkKind = opts.checkKind ?? 'scheduled'
  const due = await store.listDueForCheck(now)
  const batch = opts.limit ? due.slice(0, opts.limit) : due

  let healthy = 0
  let delisted = 0

  for (let i = 0; i < batch.length; i++) {
    const listing = batch[i]!
    const result = await probe(listing)

    // 1) Record the verification run (detail serialized to a string).
    const run: VerificationRun = {
      id: genId(),
      listingId: listing.id,
      runAt: now.toISOString(),
      checkKind,
      outcome: result.outcome,
      latencyMs: result.latencyMs,
      httpStatus: result.httpStatus,
      detail: serializeDetail(result.detail),
      errorClass: result.errorClass
    }
    await store.recordVerificationRun(run)

    // 2) Refresh payment options from the live handshake when present.
    if (result.paymentOptions) {
      await store.upsertPaymentOptions(listing.id, result.paymentOptions)
    }
    const activeOptions = await store.getPaymentOptions(listing.id)
    const hasActiveOption = activeOptions.some((o: PaymentOption) => o.isActive)

    // 3) Run the state machine over the full recent history (incl. this run).
    const runs = await store.recentVerificationsById(listing.id, 200)
    const {
      patch,
      healthy: isHealthy,
      delisted: isDelisted
    } = transition(listing, result, runs, hasActiveOption, now, i)
    await store.updateListingHealth(listing.id, patch)

    if (isHealthy) healthy++
    if (isDelisted) delisted++
  }

  return { checked: batch.length, healthy, delisted }
}

/** Serializes a structured probe detail to the string the run record stores. */
function serializeDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}
