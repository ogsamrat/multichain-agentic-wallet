import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { paymentMiddleware, x402ResourceServer } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { z } from 'zod'
import { env, SETTLEMENT_NETWORK } from './config.js'

/**
 * A minimal x402-gated seller. `POST /api/insight` is paywalled; after a valid
 * payment it returns a generated insight. Used to exercise the Prism wallet's
 * pay / x402_fetch flow end to end.
 */

const InsightRequest = z.object({
  topic: z.string().min(1).default('markets'),
  audience: z.string().min(1).optional()
})

/**
 * Build the seller app. `basePath` (e.g. "/seller") prefixes every route so the
 * x402 middleware — which keys off the request path — still gates correctly when
 * the app is mounted behind a path on a shared host (e.g. a Vercel function).
 */
export function createSellerApp(basePath = ''): Hono {
  const insightPath = `${basePath}/api/insight`
  const healthPath = `${basePath}/health`
  const infoPath = basePath || '/'

  const insightUrl = env.PUBLIC_BASE_URL
    ? new URL(insightPath, env.PUBLIC_BASE_URL).toString()
    : undefined

  const usage = {
    resource: insightUrl ?? insightPath,
    method: 'POST',
    contentType: 'application/json',
    description:
      'Pay to receive a generated insight. POST JSON { topic, audience? }.',
    requestBodyExample: { topic: 'defi', audience: 'builders' }
  } as const

  const facilitatorClient = new HTTPFacilitatorClient({
    url: env.FACILITATOR_URL
  })
  const resourceServer = new x402ResourceServer(facilitatorClient)
  resourceServer.register(SETTLEMENT_NETWORK, new ExactEvmScheme())

  const app = new Hono()
  app.use('*', logger())

  app.use(
    paymentMiddleware(
      {
        [`POST ${insightPath}`]: {
          accepts: [
            {
              scheme: 'exact',
              price: `$${env.SELLER_PRICE_USD}`,
              network: SETTLEMENT_NETWORK,
              payTo: env.SELLER_PAY_TO
            }
          ],
          resource: insightUrl,
          description: usage.description,
          mimeType: 'application/json'
        }
      },
      resourceServer
    )
  )

  app.get(infoPath, (c) =>
    c.json({
      ok: true,
      service: 'prism-example-paid-api',
      message: `POST ${insightPath} with application/json. This endpoint is x402-protected.`,
      usage,
      health: healthPath
    })
  )

  app.get(healthPath, (c) =>
    c.json({
      ok: true,
      service: 'prism-example-paid-api',
      network: SETTLEMENT_NETWORK,
      priceUsd: env.SELLER_PRICE_USD
    })
  )

  app.post(insightPath, async (c) => {
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const parsed = InsightRequest.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: parsed.error.issues.map((i) => i.message).join('; ')
      })
    }
    const { topic, audience } = parsed.data
    return c.json({
      topic,
      audience: audience ?? 'general',
      insight: `A concise, paid insight about "${topic}" for ${audience ?? 'a general audience'}.`,
      confidence: 0.9,
      generatedAt: new Date().toISOString()
    })
  })

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error('[example-paid-api]', err)
    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}
