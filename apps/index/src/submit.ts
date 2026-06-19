/**
 * Listing submission with a synchronous pre-flight.
 *
 * The registry's core promise is that nothing is listed unless it provably
 * works. So submission runs the real prober up-front: if the endpoint doesn't
 * pass (or at least degrade) the handshake, the submission is rejected outright
 * — it never even enters the registry. A successful pre-flight creates the
 * listing in `pending_verification`; the health engine promotes it to `healthy`
 * once it has accumulated enough passing evidence.
 */
import { z } from 'zod'
import { probe } from './probers/index.js'
import { reliabilityScore } from './scoring.js'
import type { Store } from './store/store.js'
import type {
  CallHint,
  Listing,
  PaymentOption,
  Provider,
  ServiceType,
  VerificationRun
} from './types.js'

const SERVICE_TYPES = [
  'x402_http_api',
  'mcp_server',
  'model_endpoint',
  'dataset',
  'compute',
  'storage',
  'rpc_infra',
  'agent_service'
] as const satisfies readonly ServiceType[]

const callHintSchema = z.object({
  method: z.string(),
  url: z.string().url(),
  contentType: z.string().optional(),
  pay_with: z.enum(['x402_fetch', 'mcp', 'none']),
  notes: z.string().optional()
})

export const submitListingSchema = z.object({
  type: z.enum(SERVICE_TYPES),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  endpointUrl: z.string().url(),
  httpMethod: z.string().optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'slug must be kebab-case (a-z, 0-9, -)')
    .min(2)
    .max(80)
    .optional(),
  providerHandle: z.string().min(2).max(64).optional(),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  inputExample: z.unknown().optional(),
  outputExample: z.unknown().optional(),
  callHint: callHintSchema.optional()
})

export type SubmitListingInput = z.input<typeof submitListingSchema>

/** Thrown when a submission is rejected (bad input or failed pre-flight). */
export class SubmissionRejected extends Error {
  constructor(
    message: string,
    readonly reason: 'invalid' | 'preflight_failed',
    readonly detail?: unknown
  ) {
    super(message)
    this.name = 'SubmissionRejected'
  }
}

function genId(prefix = 'id'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'listing'
  )
}

/**
 * Validates, pre-flights, and (on success) creates a listing. Returns the
 * created listing in `pending_verification`. Throws {@link SubmissionRejected}
 * on invalid input or a failed handshake.
 */
export async function submitListing(
  store: Store,
  input: unknown
): Promise<Listing> {
  const parsed = submitListingSchema.safeParse(input)
  if (!parsed.success) {
    throw new SubmissionRejected(
      'Submission failed validation.',
      'invalid',
      parsed.error.flatten()
    )
  }
  const data = parsed.data
  const now = new Date().toISOString()

  // Ensure a unique slug.
  let slug = data.slug ?? slugify(data.name)
  if (await store.getListingBySlug(slug)) {
    slug = `${slug}-${genId('s').slice(0, 6)}`
  }

  // Resolve/create the provider.
  const handle = data.providerHandle ?? 'anonymous'
  const provider: Provider = {
    id: genId('prov'),
    handle,
    displayName: handle,
    trustTier: 'unverified',
    createdAt: now
  }
  await store.upsertProvider(provider)

  // Build a candidate listing used for the pre-flight probe.
  const candidate: Listing = {
    id: genId('lst'),
    slug,
    providerId: provider.id,
    type: data.type,
    name: data.name,
    description: data.description,
    endpointUrl: data.endpointUrl,
    httpMethod: data.httpMethod,
    origin: originOf(data.endpointUrl),
    status: 'pending_verification',
    verifiedWorking: false,
    nextCheckAt: now,
    checkIntervalS: 300,
    consecutiveFails: 0,
    consecutivePass: 0,
    reliabilityScore: 0,
    categories: data.categories,
    tags: data.tags,
    inputSchema: data.inputSchema,
    outputSchema: data.outputSchema,
    inputExample: data.inputExample,
    outputExample: data.outputExample,
    callHint: data.callHint as CallHint | undefined,
    createdAt: now,
    updatedAt: now
  }

  // --- synchronous pre-flight ------------------------------------------
  const result = await probe(candidate)
  if (result.outcome === 'fail' || result.outcome === 'error') {
    throw new SubmissionRejected(
      `Pre-flight failed: the endpoint did not pass its ${candidate.type} handshake.`,
      'preflight_failed',
      {
        outcome: result.outcome,
        httpStatus: result.httpStatus,
        detail: result.detail
      }
    )
  }

  // The pre-flight is the listing's first verification run.
  const run: VerificationRun = {
    id: genId('vr'),
    listingId: candidate.id,
    runAt: now,
    checkKind: 'preflight',
    outcome: result.outcome,
    latencyMs: result.latencyMs,
    httpStatus: result.httpStatus,
    detail:
      typeof result.detail === 'string'
        ? result.detail
        : result.detail !== undefined
          ? JSON.stringify(result.detail)
          : undefined,
    errorClass: result.errorClass
  }

  // A passing pre-flight makes the listing immediately discoverable; the health
  // engine maintains it (and demotes/delists it) from here. We don't make
  // submitters wait for the first scheduled check, which can be a day apart.
  candidate.verifiedWorking = true
  candidate.status = result.outcome === 'pass' ? 'healthy' : 'degraded'
  candidate.consecutivePass = 1
  candidate.lastVerifiedAt = now
  candidate.p50LatencyMs = result.latencyMs ?? candidate.p50LatencyMs
  candidate.reliabilityScore = reliabilityScore(candidate, [run])
  candidate.nextCheckAt = new Date(
    Date.now() + candidate.checkIntervalS * 1000
  ).toISOString()

  await store.createListing(candidate)

  // Seed payment options from the live handshake when the prober found them.
  const options: PaymentOption[] = result.paymentOptions ?? []
  if (options.length > 0) {
    await store.upsertPaymentOptions(candidate.id, options)
  }
  await store.recordVerificationRun(run)

  return candidate
}
