#!/usr/bin/env node
// Purge gate: exits non-zero if any banned legacy identifier appears anywhere
// in the tracked source tree. Pure Node (no external tools) so it behaves
// identically on Windows, macOS, and Linux. Invoked via `npm run verify:naming`
// and in CI.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Identifiers from prior, unrelated projects that must never appear here.
// Real protocol/chain names (algorand, stellar, base, usdc, solana, ...) are
// legitimate and intentionally NOT banned.
const BANNED = [
  /pixa/i,
  /x402-wallet/i,
  /soumyacodes007/i,
  /\b402md\b/i,
  /unified[-_ ]agent[-_ ]layer/i,
  /unified_layer/i,
  /mudrex/i,
  /tinyman/i,
  /bazaar/i,
  /pizza/i,
  /\.x402\b/i,
  /(?<!PRISM_)ALGORAND_MNEMONIC/,
  /\bPIXA_/,
  /\bPIZZA_/
]

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.wrangler',
  '.vercel',
  '.turbo',
  'coverage',
  '.mcpb-build'
])

const SKIP_FILES = new Set([
  'package-lock.json',
  'verify-naming.mjs' // this file legitimately lists the banned words
])

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.mcpb',
  '.zip',
  '.wasm'
])

const NUL = String.fromCharCode(0)

/** @type {{file: string, line: number, text: string, pattern: string}[]} */
const hits = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full)
      continue
    }
    if (SKIP_FILES.has(entry)) continue
    if (BINARY_EXT.has(extname(entry).toLowerCase())) continue
    scan(full)
  }
}

function scan(file) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return
  }
  if (content.includes(NUL)) return // binary file
  const lines = content.split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const pattern of BANNED) {
      if (pattern.test(line)) {
        hits.push({
          file: relative(ROOT, file),
          line: i + 1,
          text: line.trim().slice(0, 120),
          pattern: String(pattern)
        })
      }
    }
  })
}

walk(ROOT)

if (hits.length === 0) {
  console.log('verify:naming — clean. No banned legacy identifiers found.')
  process.exit(0)
}

console.error(`verify:naming — FAILED. ${hits.length} banned identifier(s):\n`)
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}  [${h.pattern}]  ${h.text}`)
}
process.exit(1)
