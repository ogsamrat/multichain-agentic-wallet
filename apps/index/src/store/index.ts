import { MemoryStore } from './memory.js'
import type { Store } from './store.js'

export type { Store } from './store.js'
export { MemoryStore } from './memory.js'

/**
 * Returns the configured store.
 *
 * Default: a zero-dependency {@link MemoryStore}, so the app runs with no
 * external services. When `DATABASE_URL` is set, the Drizzle/Postgres store is
 * imported lazily (its driver deps never load otherwise) and used instead.
 */
export async function getStore(): Promise<Store> {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl) {
    // Lazy import keeps Postgres/Drizzle out of the default (edge/dev) bundle.
    const { PostgresStore } = await import('./postgres.js')
    return PostgresStore.create(databaseUrl)
  }
  return new MemoryStore()
}
