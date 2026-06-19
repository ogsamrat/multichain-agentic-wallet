/**
 * Prism Index — library surface.
 *
 * A verified registry of agent-payable services: a listing exists only while it
 * provably works. This barrel re-exports the pieces an embedder needs to mount
 * the API, pick a store, and drive the health engine, plus the domain types.
 */
export { createApp } from './app.js'
export { getStore, MemoryStore } from './store/index.js'
export type { Store } from './store/store.js'
export { runHealthChecks } from './health.js'
export type { HealthSummary, RunHealthChecksOptions } from './health.js'
export {
  submitListing,
  SubmissionRejected,
  submitListingSchema
} from './submit.js'
export type { SubmitListingInput } from './submit.js'
export { seedStore } from './seed.js'
export { probe } from './probers/index.js'
export type { ProbeResult } from './probers/index.js'
export { reliabilityScore, uptime30d } from './scoring.js'

export type * from './types.js'
