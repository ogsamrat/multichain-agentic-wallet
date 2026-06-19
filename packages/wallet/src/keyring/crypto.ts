import { scrypt } from '@noble/hashes/scrypt'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils'

/**
 * Authenticated, password-based encryption for the local keystore.
 *
 * scrypt stretches the passphrase into a 256-bit key; XChaCha20-Poly1305 then
 * provides authenticated encryption. Both come from audited, pure-JS @noble
 * libraries, so there is no native build step on any platform.
 */

export interface KdfParams {
  alg: 'scrypt'
  N: number
  r: number
  p: number
  salt: string // base64
}

export interface KeystoreEnvelope {
  version: 1
  kdf: KdfParams
  cipher: { alg: 'xchacha20poly1305'; nonce: string } // nonce base64
  ciphertext: string // base64
}

const SCRYPT_N = 2 ** 17
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function unb64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams
): Uint8Array {
  return scrypt(utf8ToBytes(passphrase), salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: KEY_LEN
  })
}

/** Encrypt a UTF-8 string under a passphrase into a portable envelope. */
export function encryptSecret(
  plaintext: string,
  passphrase: string
): KeystoreEnvelope {
  const salt = randomBytes(16)
  const nonce = randomBytes(24)
  const kdf: KdfParams = {
    alg: 'scrypt',
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: b64(salt)
  }
  const key = deriveKey(passphrase, salt, kdf)
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(
    utf8ToBytes(plaintext)
  )
  return {
    version: 1,
    kdf,
    cipher: { alg: 'xchacha20poly1305', nonce: b64(nonce) },
    ciphertext: b64(ciphertext)
  }
}

/** Decrypt an envelope back to its UTF-8 plaintext. Throws on wrong passphrase. */
export function decryptSecret(
  envelope: KeystoreEnvelope,
  passphrase: string
): string {
  const salt = unb64(envelope.kdf.salt)
  const nonce = unb64(envelope.cipher.nonce)
  const key = deriveKey(passphrase, salt, envelope.kdf)
  try {
    const plaintext = xchacha20poly1305(key, nonce).decrypt(
      unb64(envelope.ciphertext)
    )
    return Buffer.from(plaintext).toString('utf8')
  } catch {
    throw new Error(
      'Failed to decrypt keystore — wrong passphrase or corrupt file.'
    )
  }
}
