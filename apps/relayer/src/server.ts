import { serve } from '@hono/node-server'
import { createRelayerApp } from './app.js'
import { env } from './config.js'

const app = createRelayerApp()
serve({ fetch: app.fetch, port: env.PORT })
console.log(`Prism relayer listening on http://localhost:${env.PORT}`)
