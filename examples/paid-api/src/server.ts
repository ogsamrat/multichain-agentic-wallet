import { serve } from '@hono/node-server'
import { createSellerApp } from './app.js'
import { env, SETTLEMENT_NETWORK } from './config.js'

const app = createSellerApp()
serve({ fetch: app.fetch, port: env.PORT })
console.log(
  `Prism example seller listening on http://localhost:${env.PORT} (${SETTLEMENT_NETWORK})`
)
