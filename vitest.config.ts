import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@prism/protocol': pkg('packages/protocol/src/index.ts'),
      '@prism/core': pkg('packages/core/src/index.ts'),
      '@prism/chains': pkg('packages/chains/src/index.ts'),
      '@prism/wallet': pkg('packages/wallet/src/index.ts'),
      '@prism/sdk': pkg('packages/sdk/src/index.ts')
    }
  },
  test: {
    root,
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    environment: 'node'
  }
})
