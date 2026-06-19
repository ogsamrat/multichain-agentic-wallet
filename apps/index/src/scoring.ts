/**
 * Reliability scoring.
 *
 * A listing's score is a 0-100 blend of evidence we actually collected, never a
 * self-reported number:
 *   - uptime    (50%) : share of recent runs that passed (pass/degraded count).
 *   - recency   (20%) : did the most recent run pass, and how fresh is it.
 *   - latency   (15%) : faster is better, on a soft curve.
 *   - liveness  (15%) : corroboration from real settled payments (feedback).
 *
 * Everything is derived from the verification runs + liveness signals, so a
 * service that stops working watches its score decay automatically.
 */
import type {
  CheckOutcome,
  Listing,
  LivenessSignal,
  VerificationRun
} from './types.js'

const MS_PER_DAY = 86_400_000
const UPTIME_WINDOW_DAYS = 30

/** A run "counts as up" if it passed or was merely degraded (still usable). */
function isUp(outcome: CheckOutcome): boolean {
  return outcome === 'pass' || outcome === 'degraded'
}

/**
 * Fraction (0-1) of runs in the last 30 days that were up. Returns `undefined`
 * when there is no evidence in the window so callers can omit the field.
 */
export function uptime30d(
  runs: VerificationRun[],
  now: Date = new Date()
): number | undefined {
  const cutoff = now.getTime() - UPTIME_WINDOW_DAYS * MS_PER_DAY
  const window = runs.filter((r) => new Date(r.runAt).getTime() >= cutoff)
  if (window.length === 0) return undefined
  const up = window.filter((r) => isUp(r.outcome)).length
  return up / window.length
}

/** p50/p95 latency (ms) over runs that recorded a latency, or undefined. */
export function latencyPercentiles(runs: VerificationRun[]): {
  p50?: number
  p95?: number
} {
  const samples = runs
    .map((r) => r.latencyMs)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b)
  if (samples.length === 0) return {}
  const at = (p: number): number =>
    samples[Math.min(samples.length - 1, Math.floor(p * samples.length))]!
  return { p50: at(0.5), p95: at(0.95) }
}

/** Maps a latency in ms to a 0-1 quality factor (≤150ms great, ≥4s poor). */
function latencyFactor(latencyMs: number | undefined): number {
  if (latencyMs === undefined) return 0.6 // unknown → neutral-ish
  if (latencyMs <= 150) return 1
  if (latencyMs >= 4000) return 0
  // Linear falloff between the two anchors.
  return 1 - (latencyMs - 150) / (4000 - 150)
}

/** Maps age-since-last-good-run to a 0-1 recency factor (fresh = 1). */
function recencyFactor(lastGoodAgeMs: number | undefined): number {
  if (lastGoodAgeMs === undefined) return 0
  const hours = lastGoodAgeMs / 3_600_000
  if (hours <= 1) return 1
  if (hours >= 48) return 0
  return 1 - (hours - 1) / (48 - 1)
}

/**
 * Computes the 0-100 reliability score for a listing from its recent runs and
 * (optionally) liveness signals. Pure: no I/O, no mutation.
 */
export function reliabilityScore(
  listing: Listing,
  runs: VerificationRun[],
  liveness: LivenessSignal[] = [],
  now: Date = new Date()
): number {
  if (runs.length === 0) return 0

  // Ordered newest-first for recency math (tolerate either input order).
  const ordered = [...runs].sort(
    (a, b) => new Date(b.runAt).getTime() - new Date(a.runAt).getTime()
  )
  const latest = ordered[0]!

  // --- uptime component (50%) -----------------------------------------
  const up = uptime30d(ordered, now) ?? (isUp(latest.outcome) ? 1 : 0)

  // --- recency component (20%) ----------------------------------------
  const lastGood = ordered.find((r) => isUp(r.outcome))
  const lastGoodAge = lastGood
    ? now.getTime() - new Date(lastGood.runAt).getTime()
    : undefined
  // A failing latest run pulls recency toward 0 even if a stale good run exists.
  const recency = isUp(latest.outcome) ? recencyFactor(lastGoodAge) : 0

  // --- latency component (15%) ----------------------------------------
  const { p50 } = latencyPercentiles(ordered.slice(0, 20))
  const latency = latencyFactor(p50 ?? listing.p50LatencyMs)

  // --- liveness component (15%) ---------------------------------------
  // Real settled payments are the strongest possible signal of "it works".
  const recentLiveness = liveness.filter(
    (s) => now.getTime() - new Date(s.reportedAt).getTime() <= 7 * MS_PER_DAY
  )
  let live = 0.5 // neutral when we have no corroboration either way
  if (recentLiveness.length > 0) {
    const settled = recentLiveness.filter((s) => s.settled).length
    live = settled / recentLiveness.length
  }

  const blended = up * 0.5 + recency * 0.2 + latency * 0.15 + live * 0.15
  return Math.round(Math.max(0, Math.min(1, blended)) * 100)
}
