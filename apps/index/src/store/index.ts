import { MemoryStore } from './memory.js'
import type { Store } from './store.js'

export type { Store } from './store.js'
export { MemoryStore } from './memory.js'

/** Connection-string env vars, in priority order. Covers Vercel's Neon/Postgres
 * integration (which injects `POSTGRES_URL`) and a plain `DATABASE_URL`. */
const DB_ENV_VARS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'NEON_DATABASE_URL'
]

function databaseUrl(): string | undefined {
  for (const key of DB_ENV_VARS) {
    const v = process.env[key]
    if (v && v.length > 0) return v
  }
  return undefined
}

/**
 * Returns the configured store.
 *
 * Default: a zero-dependency {@link MemoryStore}, so the app runs with no
 * external services. When a Postgres connection string is present in the
 * environment, the durable Neon-backed store is imported lazily (its driver
 * never loads otherwise) and used instead.
 */
export async function getStore(): Promise<Store> {
  const url = databaseUrl()
  if (url) {
    const { PostgresStore } = await import('./postgres.js')
    return PostgresStore.create(url)
  }
  return new MemoryStore()
}
