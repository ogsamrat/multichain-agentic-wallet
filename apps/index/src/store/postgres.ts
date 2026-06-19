/**
 * Postgres-backed store (secondary implementation).
 *
 * This is a thin stub for now: the Drizzle table definitions live in
 * `schema.ts` and are imported here purely so they participate in type-checking,
 * but the query layer is not wired up yet. The store factory only ever
 * instantiates this when `DATABASE_URL` is set, so the default in-memory path is
 * completely unaffected.
 *
 * Every method throws `not yet implemented`; swap the bodies for real Drizzle
 * queries (over `@neondatabase/serverless` on the edge, or `pg` on Node) to
 * promote this to the production backend without touching any caller.
 */
import type {
  Category,
  Listing,
  ListingFilter,
  LivenessSignal,
  PaymentOption,
  Provider,
  VerificationRun
} from '../types.js'
import * as schema from './schema.js'
import type { Store } from './store.js'

const NYI = (): never => {
  throw new Error('PostgresStore: not yet implemented')
}

export class PostgresStore implements Store {
  readonly kind = 'postgres' as const

  /** The Drizzle schema this store is built against (kept for the real impl). */
  static readonly schema = schema

  private constructor(readonly databaseUrl: string) {}

  /**
   * Lazily constructs a Postgres store. The actual driver wiring (Neon/pg +
   * `drizzle()`) is deferred until the query layer is implemented.
   */
  static async create(databaseUrl: string): Promise<PostgresStore> {
    return new PostgresStore(databaseUrl)
  }

  async isEmpty(): Promise<boolean> {
    return NYI()
  }

  async upsertProvider(_provider: Provider): Promise<Provider> {
    return NYI()
  }

  async getProvider(_id: string): Promise<Provider | undefined> {
    return NYI()
  }

  async createListing(_listing: Listing): Promise<Listing> {
    return NYI()
  }

  async getListingBySlug(_slug: string): Promise<Listing | undefined> {
    return NYI()
  }

  async getListingById(_id: string): Promise<Listing | undefined> {
    return NYI()
  }

  async searchListings(_query: ListingFilter): Promise<Listing[]> {
    return NYI()
  }

  async updateListing(
    _id: string,
    _patch: Partial<Listing>
  ): Promise<Listing | undefined> {
    return NYI()
  }

  async updateListingHealth(
    _listingId: string,
    _patch: Partial<Listing>
  ): Promise<Listing | undefined> {
    return NYI()
  }

  async listDueForCheck(_now: Date): Promise<Listing[]> {
    return NYI()
  }

  async upsertPaymentOptions(
    _listingId: string,
    _options: PaymentOption[]
  ): Promise<PaymentOption[]> {
    return NYI()
  }

  async getPaymentOptions(_listingId: string): Promise<PaymentOption[]> {
    return NYI()
  }

  async recordVerificationRun(_run: VerificationRun): Promise<VerificationRun> {
    return NYI()
  }

  async recentVerifications(
    _slug: string,
    _limit?: number
  ): Promise<VerificationRun[]> {
    return NYI()
  }

  async recentVerificationsById(
    _listingId: string,
    _limit?: number
  ): Promise<VerificationRun[]> {
    return NYI()
  }

  async recordLivenessSignal(_signal: LivenessSignal): Promise<LivenessSignal> {
    return NYI()
  }

  async recentLiveness(
    _listingId: string,
    _limit?: number
  ): Promise<LivenessSignal[]> {
    return NYI()
  }

  async listCategories(): Promise<Category[]> {
    return NYI()
  }
}
