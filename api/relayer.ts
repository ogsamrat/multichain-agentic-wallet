import { getRequestListener } from '@hono/node-server'
import { Hono } from 'hono'
import { createRelayerApp } from '@prism/relayer'

// Vercel Node Function: the optional treasury relayer.
// Routes (via vercel.json rewrites): /relayer/* -> this function, e.g.
//   GET  /relayer/health
//   POST /relayer/api/settle
//   GET  /relayer/api/treasury
//   POST /relayer/api/onramp
export const config = { runtime: 'nodejs' }

const app = new Hono()
app.route('/relayer', createRelayerApp())

export default getRequestListener(app.fetch)
