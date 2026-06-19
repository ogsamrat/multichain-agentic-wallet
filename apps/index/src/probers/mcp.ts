import type { Listing } from '../types.js'
import type { ProbeResult } from './index.js'
import { classifyNetworkError, errMessage, timedFetch } from './index.js'

/**
 * Verifies an MCP server over the streamable-HTTP transport with a real
 * JSON-RPC handshake:
 *   1. POST `initialize` and read the server's capabilities.
 *   2. POST `tools/list` and confirm at least one tool is exposed.
 *
 * Outcomes:
 *  - pass:     initialize ok AND >= 1 tool listed.
 *  - degraded: initialize ok but tools/list empty or unreadable.
 *  - fail:     initialize did not produce a JSON-RPC result.
 *  - error:    the endpoint could not be reached.
 *
 * Best-effort: MCP HTTP servers vary (some return SSE framing), so the body
 * reader tolerates both raw JSON and `data:`-prefixed event-stream lines.
 */
export async function probeMcp(listing: Listing): Promise<ProbeResult> {
  const url = listing.endpointUrl
  // MCP HTTP servers commonly require accepting both content types.
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  }

  let initLatency = 0
  try {
    const initReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'prism-index-prober', version: '0.1.0' }
      }
    }
    const init = await timedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(initReq)
    })
    initLatency = init.latencyMs

    if (init.response.status < 200 || init.response.status >= 300) {
      return {
        outcome: 'fail',
        latencyMs: initLatency,
        httpStatus: init.response.status,
        detail: { phase: 'initialize', error: `HTTP ${init.response.status}` },
        errorClass: 'mcp_initialize_http'
      }
    }

    const initMsg = await readJsonRpc(init.response)
    if (!initMsg || initMsg.error || initMsg.result === undefined) {
      return {
        outcome: 'fail',
        latencyMs: initLatency,
        httpStatus: init.response.status,
        detail: {
          phase: 'initialize',
          error: initMsg?.error ?? 'no JSON-RPC result'
        },
        errorClass: 'mcp_initialize_failed'
      }
    }

    // Capture an MCP session id if the server issued one (spec header).
    const sessionId =
      init.response.headers.get('mcp-session-id') ??
      init.response.headers.get('Mcp-Session-Id') ??
      undefined

    // --- tools/list -----------------------------------------------------
    const listReq = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
    const list = await timedFetch(url, {
      method: 'POST',
      headers: sessionId
        ? { ...headers, 'mcp-session-id': sessionId }
        : headers,
      body: JSON.stringify(listReq)
    })
    const totalLatency = initLatency + list.latencyMs

    const listMsg = await readJsonRpc(list.response)
    const tools = extractTools(listMsg?.result)

    if (tools.length >= 1) {
      return {
        outcome: 'pass',
        latencyMs: totalLatency,
        httpStatus: list.response.status,
        detail: {
          toolCount: tools.length,
          tools: tools.slice(0, 25),
          serverInfo: extractServerInfo(initMsg.result)
        }
      }
    }

    return {
      outcome: 'degraded',
      latencyMs: totalLatency,
      httpStatus: list.response.status,
      detail: {
        toolCount: 0,
        note: 'initialize ok but tools/list returned no tools',
        serverInfo: extractServerInfo(initMsg.result)
      },
      errorClass: 'mcp_no_tools'
    }
  } catch (err) {
    return {
      outcome: 'error',
      latencyMs: initLatency,
      detail: { error: errMessage(err) },
      errorClass: classifyNetworkError(err)
    }
  }
}

interface JsonRpcMessage {
  result?: unknown
  error?: unknown
}

/**
 * Reads a single JSON-RPC response from an MCP HTTP reply, tolerating both
 * `application/json` bodies and `text/event-stream` (SSE) framing where the
 * payload arrives on `data:` lines.
 */
async function readJsonRpc(res: Response): Promise<JsonRpcMessage | undefined> {
  const text = await res.text()
  if (!text.trim()) return undefined

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream') || text.startsWith('event:')) {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice('data:'.length).trim()
        if (!payload) continue
        try {
          return JSON.parse(payload) as JsonRpcMessage
        } catch {
          // keep scanning for a parseable data line
        }
      }
    }
    return undefined
  }

  try {
    return JSON.parse(text) as JsonRpcMessage
  } catch {
    return undefined
  }
}

/** Pulls tool names out of a tools/list result, however it's shaped. */
function extractTools(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const tools = (result as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return []
  return tools
    .map((t) =>
      t && typeof t === 'object' ? (t as { name?: unknown }).name : undefined
    )
    .filter((n): n is string => typeof n === 'string')
}

/** Extracts `serverInfo` (name/version) from an initialize result if present. */
function extractServerInfo(result: unknown): unknown {
  if (result && typeof result === 'object') {
    return (result as { serverInfo?: unknown }).serverInfo
  }
  return undefined
}
