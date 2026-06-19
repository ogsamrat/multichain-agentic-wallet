/**
 * A stdio-safe logger.
 *
 * MCP servers speak JSON-RPC over stdout. Any stray write to stdout corrupts the
 * protocol, and several payment libraries log verbosely via `console.log`. This
 * logger always writes to stderr, and `redirectConsoleToStderr()` reroutes the
 * global console so third-party stdout writes can never break the transport.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

function envLevel(): LogLevel {
  const raw = (process.env.PRISM_LOG_LEVEL ?? 'info').toLowerCase()
  return raw in LEVEL_ORDER ? (raw as LogLevel) : 'info'
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  child(scope: string): Logger
}

function writeStderr(scope: string, level: LogLevel, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[envLevel()]) return
  const parts = args.map((a) => (typeof a === 'string' ? a : safeStringify(a)))
  process.stderr.write(
    `[${level}]${scope ? ` ${scope}` : ''} ${parts.join(' ')}\n`
  )
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    )
  } catch {
    return String(value)
  }
}

export function createLogger(scope = ''): Logger {
  return {
    debug: (...a) => writeStderr(scope, 'debug', a),
    info: (...a) => writeStderr(scope, 'info', a),
    warn: (...a) => writeStderr(scope, 'warn', a),
    error: (...a) => writeStderr(scope, 'error', a),
    child: (sub) => createLogger(scope ? `${scope}:${sub}` : sub)
  }
}

/**
 * Force every console method onto stderr. Call this first in any stdio MCP
 * entrypoint, before importing libraries that may log.
 */
export function redirectConsoleToStderr(): void {
  const write = (...args: unknown[]) => {
    process.stderr.write(
      args
        .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
        .join(' ') + '\n'
    )
  }
  console.log = write
  console.info = write
  console.debug = write
  console.warn = write
  console.error = write
}

export const logger = createLogger('prism')
