import type {
  Category,
  Listing,
  ListingFilter,
  LivenessSignal,
  PaymentOption,
  Provider,
  VerificationRun
} from '../types.js'

/**
 * Storage abstraction for the registry. Two implementations sit behind this
 * interface: an in-memory store (the default, zero external dependencies) and a
 * Drizzle/Postgres store (loaded only when `DATABASE_URL` is set).
 *
 * Every input/output is a plain domain object from `types.ts`. The interface is
 * intentionally narrow so both backends stay easy to reason about, and it speaks
 * in the verbs the rest of the app uses (`searchListings`, `listDueForCheck`,
 * `recordVerificationRun`, `updateListingHealth`).
 */
export interface Store {
  /** A short, human-readable name for diagnostics/logging. */
  readonly kind: 'memory' | 'postgres'

  /** True when no listings have been created yet (used to decide seeding). */
  isEmpty(): Promise<boolean>

  // --- providers ---------------------------------------------------------
  upsertProvider(provider: Provider): Promise<Provider>
  getProvider(id: string): Promise<Provider | undefined>

  // --- listings ----------------------------------------------------------
  createListing(listing: Listing): Promise<Listing>
  getListingBySlug(slug: string): Promise<Listing | undefined>
  getListingById(id: string): Promise<Listing | undefined>
  /** Full-featured search used by `/v1/search` (filters + keyword rank). */
  searchListings(query: ListingFilter): Promise<Listing[]>
  updateListing(
    id: string,
    patch: Partial<Listing>
  ): Promise<Listing | undefined>
  /** Listings whose `nextCheckAt` is at or before `now` (health scheduler). */
  listDueForCheck(now: Date): Promise<Listing[]>

  // --- payment options ---------------------------------------------------
  upsertPaymentOptions(
    listingId: string,
    options: PaymentOption[]
  ): Promise<PaymentOption[]>
  getPaymentOptions(listingId: string): Promise<PaymentOption[]>

  // --- verification history ---------------------------------------------
  recordVerificationRun(run: VerificationRun): Promise<VerificationRun>
  recentVerifications(slug: string, limit?: number): Promise<VerificationRun[]>
  recentVerificationsById(
    listingId: string,
    limit?: number
  ): Promise<VerificationRun[]>

  /**
   * Atomically applies a health update to a listing: status, counters, score,
   * payment-option activity, and scheduling. This is the single write path the
   * health state machine uses so both backends stay consistent.
   */
  updateListingHealth(
    listingId: string,
    patch: Partial<Listing>
  ): Promise<Listing | undefined>

  // --- liveness signals --------------------------------------------------
  recordLivenessSignal(signal: LivenessSignal): Promise<LivenessSignal>
  recentLiveness(listingId: string, limit?: number): Promise<LivenessSignal[]>

  // --- facets ------------------------------------------------------------
  listCategories(): Promise<Category[]>
}
