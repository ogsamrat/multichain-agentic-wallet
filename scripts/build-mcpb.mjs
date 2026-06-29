#!/usr/bin/env node
// Builds `prism.mcpb` — the one-click Claude Desktop bundle.
//
// Steps: bundle the MCP server (and all its deps) into a single self-contained
// ESM file with esbuild, assemble the bundle dir (manifest + icon + server),
// and zip it with archiver. Cross-platform; no shell, no `zip`.
//
// Prereq: `npm run build` (so packages/mcp-server/dist exists).
import { build } from 'esbuild'
import archiver from 'archiver'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const r = (...p) => path.join(root, ...p)

const entry = r('packages/mcp-server/dist/index.js')
if (!existsSync(entry)) {
  console.error('Missing build output. Run `npm run build` first.')
  process.exit(1)
}

const buildDir = r('.mcpb-build')
const serverDir = path.join(buildDir, 'server')
const output = r('prism.mcpb')
rmSync(buildDir, { recursive: true, force: true })
rmSync(output, { force: true })
mkdirSync(serverDir, { recursive: true })

console.log('Bundling MCP server…')
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(serverDir, 'index.js'),
  minify: true,
  legalComments: 'none',
  // Shim for CJS deps that call require()/__dirname inside an ESM bundle.
  banner: {
    js: [
      "import{createRequire as ___cr}from'node:module';",
      "import{fileURLToPath as ___fu}from'node:url';",
      "import{dirname as ___dn}from'node:path';",
      'const require=___cr(import.meta.url);',
      'const __filename=___fu(import.meta.url);',
      'const __dirname=___dn(__filename);'
    ].join('')
  },
  logLevel: 'warning'
})

copyFileSync(
  r('packages/mcp-server/manifest.json'),
  path.join(buildDir, 'manifest.json')
)
copyFileSync(r('assets/prism-icon.png'), path.join(buildDir, 'prism-icon.png'))

console.log('Packing prism.mcpb…')
await new Promise((resolve, reject) => {
  const out = createWriteStream(output)
  const archive = archiver('zip', { zlib: { level: 9 } })
  out.on('close', resolve)
  archive.on('error', reject)
  archive.pipe(out)
  archive.file(path.join(buildDir, 'manifest.json'), { name: 'manifest.json' })
  archive.file(path.join(buildDir, 'prism-icon.png'), {
    name: 'prism-icon.png'
  })
  archive.directory(serverDir, 'server')
  archive.finalize()
})

rmSync(buildDir, { recursive: true, force: true })
console.log(`Done: ${output} (${(statSync(output).size / 1e6).toFixed(1)} MB)`)
