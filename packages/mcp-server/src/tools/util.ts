import { PrismError } from '@prism/core'

export interface ToolResult {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, replacer, 2) }]
  }
}

export function errorResult(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, replacer, 2) }],
    isError: true
  }
}

/** Run a tool body, returning a JSON result or a structured error. */
export async function run(
  fn: () => Promise<unknown> | unknown
): Promise<ToolResult> {
  try {
    return jsonResult(await fn())
  } catch (err) {
    if (err instanceof PrismError) {
      return errorResult({
        error: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {})
      })
    }
    return errorResult({
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
