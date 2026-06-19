import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { KeystoreEnvelope } from './crypto.js'

/**
 * On-disk layout for the local wallet. Everything lives under `$PRISM_HOME`
 * (default `~/.prism`): an encrypted secrets envelope, a non-secret config file,
 * and the durable spending ledger.
 */

export function prismHome(): string {
  return process.env.PRISM_HOME ?? path.join(os.homedir(), '.prism')
}

export function keystorePath(): string {
  return path.join(prismHome(), 'keystore.json')
}

export function configPath(): string {
  return path.join(prismHome(), 'config.json')
}

export function ledgerPath(): string {
  return path.join(prismHome(), 'ledger.json')
}

export function ensureHome(): void {
  fs.mkdirSync(prismHome(), { recursive: true, mode: 0o700 })
}

export function keystoreExists(): boolean {
  return fs.existsSync(keystorePath())
}

export function readKeystore(): KeystoreEnvelope | null {
  try {
    return JSON.parse(
      fs.readFileSync(keystorePath(), 'utf8')
    ) as KeystoreEnvelope
  } catch {
    return null
  }
}

export function writeKeystore(envelope: KeystoreEnvelope): void {
  ensureHome()
  fs.writeFileSync(keystorePath(), JSON.stringify(envelope, null, 2) + '\n', {
    mode: 0o600
  })
}

export interface PrismFileConfig {
  defaultNetwork?: string
  createdAt?: string
  addresses?: Record<string, string>
}

export function readFileConfig(): PrismFileConfig | null {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as PrismFileConfig
  } catch {
    return null
  }
}

export function writeFileConfig(config: PrismFileConfig): void {
  ensureHome()
  const existing = readFileConfig() ?? {}
  fs.writeFileSync(
    configPath(),
    JSON.stringify({ ...existing, ...config }, null, 2) + '\n',
    { mode: 0o600 }
  )
}
