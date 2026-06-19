/**
 * Drizzle/Postgres table definitions for the registry.
 *
 * These tables back {@link PostgresStore}. They mirror the domain shapes in
 * `types.ts` closely; JSON columns hold the loosely-typed bits (schemas,
 * examples, call hints). The schema is only loaded when `DATABASE_URL` is set.
 */
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core'

export const providers = pgTable('providers', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  displayName: text('display_name').notNull(),
  trustTier: text('trust_tier').notNull().default('unverified'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow()
})

export const listings = pgTable('listings', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  providerId: text('provider_id').notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  endpointUrl: text('endpoint_url').notNull(),
  httpMethod: text('http_method'),
  origin: text('origin').notNull(),
  status: text('status').notNull().default('pending_verification'),
  verifiedWorking: boolean('verified_working').notNull().default(false),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull(),
  checkIntervalS: integer('check_interval_s').notNull().default(900),
  consecutiveFails: integer('consecutive_fails').notNull().default(0),
  consecutivePass: integer('consecutive_pass').notNull().default(0),
  reliabilityScore: doublePrecision('reliability_score').notNull().default(0),
  uptime30d: doublePrecision('uptime_30d'),
  p50LatencyMs: integer('p50_latency_ms'),
  p95LatencyMs: integer('p95_latency_ms'),
  categories: jsonb('categories').$type<string[]>().notNull().default([]),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  inputSchema: jsonb('input_schema'),
  outputSchema: jsonb('output_schema'),
  inputExample: jsonb('input_example'),
  outputExample: jsonb('output_example'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callHint: jsonb('call_hint').$type<any>(),
  enteredUnhealthyAt: timestamp('entered_unhealthy_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
})

export const paymentOptions = pgTable('payment_options', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull(),
  scheme: text('scheme').notNull(),
  networkCaip2: text('network_caip2').notNull(),
  asset: text('asset').notNull(),
  assetSymbol: text('asset_symbol').notNull().default(''),
  assetDecimals: integer('asset_decimals').notNull().default(6),
  payTo: text('pay_to').notNull(),
  amountAtomic: text('amount_atomic').notNull(),
  priceUsd: doublePrecision('price_usd'),
  isActive: boolean('is_active').notNull().default(true)
})

export const verificationRuns = pgTable('verification_runs', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  checkKind: text('check_kind').notNull().default('scheduled'),
  outcome: text('outcome').notNull(),
  latencyMs: integer('latency_ms'),
  httpStatus: integer('http_status'),
  detail: text('detail').notNull().default(''),
  errorClass: text('error_class'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: jsonb('meta').$type<any>()
})

export const livenessSignals = pgTable('liveness_signals', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull(),
  network: text('network').notNull(),
  settled: boolean('settled').notNull().default(false),
  latencyMs: integer('latency_ms'),
  reportedAt: timestamp('reported_at', { withTimezone: true })
    .notNull()
    .defaultNow()
})

export const uptimeBuckets = pgTable('uptime_buckets', {
  listingId: text('listing_id').notNull(),
  hourStart: timestamp('hour_start', { withTimezone: true }).notNull(),
  passes: integer('passes').notNull().default(0),
  total: integer('total').notNull().default(0)
})
