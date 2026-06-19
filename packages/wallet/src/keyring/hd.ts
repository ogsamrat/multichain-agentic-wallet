import { HDKey } from '@scure/bip32'
import {
  generateMnemonic as bip39Generate,
  mnemonicToSeedSync,
  validateMnemonic
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { bytesToHex } from '@noble/hashes/utils'

/**
 * Hierarchical-deterministic key derivation from a single BIP-39 mnemonic.
 * Each chain family uses its standard derivation path so one recovery phrase
 * backs every chain. (Ed25519 chains are added alongside their adapters.)
 */

/** Standard derivation paths per chain family. */
export const DERIVATION_PATHS = {
  evm: "m/44'/60'/0'/0/0",
  bitcoin: "m/84'/0'/0'/0/0"
} as const

/** Generate a fresh 12-word BIP-39 mnemonic. */
export function generateMnemonic(): string {
  return bip39Generate(wordlist, 128)
}

/** Validate a BIP-39 mnemonic. */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim(), wordlist)
}

/** Derive the secp256k1 private key (0x-hex) used across all EVM chains. */
export function deriveEvmPrivateKey(mnemonic: string): `0x${string}` {
  const seed = mnemonicToSeedSync(mnemonic.trim())
  const node = HDKey.fromMasterSeed(seed).derive(DERIVATION_PATHS.evm)
  if (!node.privateKey) throw new Error('Failed to derive EVM private key.')
  return `0x${bytesToHex(node.privateKey)}`
}
