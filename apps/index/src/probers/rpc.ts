import type { Listing } from '../types.js'
import type { ProbeResult } from './index.js'
import { classifyNetworkError, errMessage, timedFetch } from './index.js'

/**
 * Verifies an RPC infrastructure endpoint.
 *
 * Primary path (EVM): POST `{jsonrpc:'2.0',id:1,method:'eth_blockNumber'}` and
 * pass when a hex block number comes back. For non-EVM RPC the method won't
 * exist, so a JSON-RPC error (rather than a transport failure) still proves the
 * endpoint is reachable and speaking JSON-RPC — we degrade to a reachability
 * check in that case.
 *
 * Outcomes:
 *  - pass:     a hex `eth_blockNumber` result was returned.
 *  - degraded: reachable + speaks JSON-RPC, but `eth_blockNumber` unsupported.
 *  - fail:     a non-2xx HTTP status or an unparseable response.
 *  - error:    the endpoint could not be reached.
 */
export async function probeRpc(listing: Listing): Promise<ProbeResult> {
  const url = listing.endpointUrl
  const req = { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }

  let res: Response
  let latencyMs: number
  try {
    const r = await timedFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(req)
    })
    res = r.response
    latencyMs = r.latencyMs
  } catch (err) {
    return {
      outcome: 'error',
      latencyMs: 0,
      detail: { error: errMessage(err) },
      errorClass: classifyNetworkError(err)
    }
  }

  if (res.status < 200 || res.status >= 300) {
    return {
      outcome: 'fail',
      latencyMs,
      httpStatus: res.status,
      detail: { error: `HTTP ${res.status}` },
      errorClass: res.status >= 500 ? 'server_error' : 'unexpected_status'
    }
  }

  let body: { result?: unknown; error?: unknown } | undefined
  try {
    body = (await res.json()) as { result?: unknown; error?: unknown }
  } catch (err) {
    return {
      outcome: 'fail',
      latencyMs,
      httpStatus: res.status,
      detail: { error: `unparseable JSON-RPC response: ${errMessage(err)}` },
      errorClass: 'bad_jsonrpc'
    }
  }

  const result = body?.result
  if (typeof result === 'string' && /^0x[0-9a-fA-F]+$/.test(result)) {
    return {
      outcome: 'pass',
      latencyMs,
      httpStatus: res.status,
      detail: {
        blockNumber: result,
        blockNumberDec: Number.parseInt(result, 16)
      }
    }
  }

  // Reachable and answered as JSON-RPC, just not an EVM block number.
  // Treat as a generic reachability pass-with-caveat (non-EVM RPC).
  if (body && (body.error !== undefined || 'result' in body)) {
    return {
      outcome: 'degraded',
      latencyMs,
      httpStatus: res.status,
      detail: {
        note: 'reachable JSON-RPC endpoint; eth_blockNumber unsupported (non-EVM?)',
        rpcError: body.error
      },
      errorClass: 'non_evm_rpc'
    }
  }

  return {
    outcome: 'fail',
    latencyMs,
    httpStatus: res.status,
    detail: { error: 'no JSON-RPC result or error field' },
    errorClass: 'bad_jsonrpc'
  }
}
