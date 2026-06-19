import { getRequestListener } from '@hono/node-server'
import { createSellerApp } from '@prism/example-paid-api'

// Vercel Node Function: a live x402-gated example seller.
// Routes (via vercel.json rewrites): /seller/* -> this function, e.g.
//   GET  /seller            service info
//   GET  /seller/health
//   POST /seller/api/insight  (x402-protected: returns 402 until paid)
// The app is built with the /seller base path so the x402 middleware gates the
// prefixed route correctly.
export const config = { runtime: 'nodejs' }

const app = createSellerApp('/seller')

export default getRequestListener(app.fetch)
