import { KeyringLockedError, NoKeyForChainError, PrismError } from '@prism/core'
import type { ChainFamily } from '@prism/protocol'
import type { ChainSecret } from '@prism/chains'
import { decryptSecret, encryptSecret } from './crypto.js'
import { deriveEvmPrivateKey } from './hd.js'
import { ensureHome, readKeystore, writeKeystore } from './keystore.js'

/** Decrypted secret material held in memory while the wallet is unlocked. */
export interface KeyMaterial {
  mnemonic?: string
  evmPrivateKey?: string
  solanaSecretKey?: string
  algorandMnemonic?: string
  stellarSecret?: string
  bitcoin?: string
}

function normalizeHexKey(key: string): string {
  return key.startsWith('0x') ? key : `0x${key}`
}

/**
 * Owns all secret material. Adapters never receive the master seed — only the
 * chain-native secret they need for one authorized action. The keyring is the
 * single custody boundary in the system.
 */
export class Keyring {
  private material: KeyMaterial | null
  private readonly envOverrides: KeyMaterial

  constructor(opts?: { env?: KeyMaterial; startUnlocked?: boolean }) {
    this.envOverrides = opts?.env ?? {}
    this.material = opts?.startUnlocked ? { ...this.envOverrides } : null
  }

  get locked(): boolean {
    return this.material === null
  }

  /** Decrypt the keystore with a passphrase; env keys still take precedence. */
  unlock(passphrase: string): void {
    const envelope = readKeystore()
    if (!envelope) {
      throw new PrismError(
        'CONFIG_ERROR',
        'No keystore found. Create one with init_wallet first.'
      )
    }
    const stored = JSON.parse(
      decryptSecret(envelope, passphrase)
    ) as KeyMaterial
    this.material = { ...stored, ...this.envOverrides }
  }

  lock(): void {
    this.material = null
  }

  /** Persist a new encrypted keystore and unlock it in memory. */
  static create(material: KeyMaterial, passphrase: string): void {
    ensureHome()
    writeKeystore(encryptSecret(JSON.stringify(material), passphrase))
  }

  hasFamily(family: ChainFamily): boolean {
    try {
      this.secretFor(family)
      return true
    } catch {
      return false
    }
  }

  /** Return the chain-native secret for a family, deriving from seed if needed. */
  secretFor(family: ChainFamily): ChainSecret {
    if (!this.material) throw new KeyringLockedError()
    const m = this.material
    switch (family) {
      case 'evm':
        if (m.evmPrivateKey)
          return { family: 'evm', privateKey: normalizeHexKey(m.evmPrivateKey) }
        if (m.mnemonic)
          return { family: 'evm', privateKey: deriveEvmPrivateKey(m.mnemonic) }
        throw new NoKeyForChainError('evm')
      case 'algorand':
        if (m.algorandMnemonic)
          return { family: 'algorand', mnemonic: m.algorandMnemonic }
        throw new NoKeyForChainError('algorand')
      case 'stellar':
        if (m.stellarSecret)
          return { family: 'stellar', secret: m.stellarSecret }
        throw new NoKeyForChainError('stellar')
      case 'svm':
        throw new NoKeyForChainError('svm')
      case 'bitcoin':
      case 'lightning':
        throw new NoKeyForChainError(family)
      default:
        throw new NoKeyForChainError(family)
    }
  }
}
