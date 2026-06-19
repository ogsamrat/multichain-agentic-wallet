import { Transaction, WIF, getAddress, p2wpkh } from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { PrismError } from '@prism/core'
import type {
  FundingUriBuilding,
  MessageSigning,
  ChainAdapter
} from '../adapter.js'
import type {
  AssetRef,
  Balance,
  Capability,
  ChainInfo,
  ChainSecret,
  FeeEstimate,
  SendOpts,
  SimResult,
  TransferIntent,
  TxRef,
  TxStatus
} from '../types.js'
import type { BitcoinChainParams, BitcoinNetwork } from './networks.js'

const CAPS: Capability[] = ['native_transfer', 'funding_uri', 'message_signing']

const SATS_PER_BTC = 100_000_000n

/**
 * Approximate virtual size (vBytes) of a 1-input / 2-output P2WPKH spend.
 * Used only for fee estimation; the real size is taken from the signed tx.
 */
const ESTIMATED_VSIZE = 140

/** An unspent output as returned by the Esplora `/address/:a/utxo` endpoint. */
interface EsploraUtxo {
  txid: string
  vout: number
  value: number
  status: { confirmed: boolean }
}

/** One adapter instance serves one Bitcoin network (mainnet or testnet). */
export class BitcoinAdapter
  implements ChainAdapter, MessageSigning, FundingUriBuilding
{
  readonly info: ChainInfo
  readonly capabilities: ReadonlySet<Capability> = new Set(CAPS)

  private readonly net: BitcoinNetwork

  constructor(net: BitcoinNetwork) {
    this.net = net
    this.info = {
      caip2: net.caip2,
      family: 'bitcoin',
      accountModel: 'utxo',
      displayName: net.displayName,
      aliases: net.aliases,
      testnet: net.testnet,
      nativeAsset: this.nativeAsset()
    }
  }

  supports(cap: Capability): boolean {
    return this.capabilities.has(cap)
  }

  // ── identity ───────────────────────────────────────────────────────────────

  async deriveAddress(secret: ChainSecret): Promise<string> {
    const priv = this.privKey(secret)
    const address = getAddress('wpkh', priv, this.params())
    if (!address) {
      throw new PrismError('INTERNAL', 'Could not derive P2WPKH address.')
    }
    return address
  }

  // ── assets ───────────────────────────────────────────────────────────────

  private nativeAsset(): AssetRef {
    return {
      caip19: `${this.net.caip2}/slip44:0`,
      symbol: this.net.nativeSymbol,
      decimals: this.net.nativeDecimals,
      native: true
    }
  }

  async resolveAsset(ref: string): Promise<AssetRef | null> {
    const lower = ref.trim().toLowerCase()
    if (lower === 'native' || lower === 'btc' || lower === 'bitcoin') {
      return this.nativeAsset()
    }
    return null
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  async getNativeBalance(address: string): Promise<Balance> {
    const stats = await this.esploraJson<{
      chain_stats: { funded_txo_sum: number; spent_txo_sum: number }
    }>(`/address/${address}`)
    const sats =
      BigInt(stats.chain_stats.funded_txo_sum) -
      BigInt(stats.chain_stats.spent_txo_sum)
    return {
      asset: this.nativeAsset(),
      atomic: sats,
      human: this.satsToBtc(sats)
    }
  }

  // Bitcoin has no tokens; the capability set omits token_balance.
  async getTokenBalances(
    _address: string,
    _assets?: AssetRef[]
  ): Promise<Balance[]> {
    return []
  }

  async getTxStatus(hash: string): Promise<TxStatus> {
    try {
      const tx = await this.esploraJson<{ status: { confirmed: boolean } }>(
        `/tx/${hash}`
      )
      return tx.status.confirmed ? 'confirmed' : 'pending'
    } catch (err) {
      if (err instanceof PrismError && err.details?.status === 404) {
        return 'unknown'
      }
      return 'unknown'
    }
  }

  explorerUrl(ref: {
    tx?: string
    address?: string
    asset?: string
  }): string | undefined {
    const base = this.net.explorer
    if (ref.tx) return `${base}/tx/${ref.tx}`
    if (ref.address) return `${base}/address/${ref.address}`
    return undefined
  }

  // ── fee / simulate ───────────────────────────────────────────────────────

  async estimateFee(intent: TransferIntent): Promise<FeeEstimate> {
    const rate = await this.feeRate()
    const sats = BigInt(Math.ceil(rate * ESTIMATED_VSIZE))
    const native = this.nativeAsset()
    return {
      asset: native,
      atomic: sats,
      human: this.satsToBtc(sats),
      tier: intent.feeTier ?? 'normal'
    }
  }

  async simulate(intent: TransferIntent, from: string): Promise<SimResult> {
    const warnings: string[] = []
    const fee = await this.estimateFee(intent)
    try {
      const balance = await this.getNativeBalance(from)
      if (balance.atomic < intent.amountAtomic + fee.atomic) {
        warnings.push('Balance may not cover amount plus network fee.')
      }
    } catch {
      warnings.push('Could not read balance for simulation.')
    }
    return { ok: warnings.length === 0, fee, warnings }
  }

  // ── send ─────────────────────────────────────────────────────────────────

  /**
   * Build, sign and broadcast a native segwit (P2WPKH) transfer.
   *
   * Coin selection is intentionally simple: confirmed UTXOs are sorted
   * largest-first and consumed until they cover `amount + fee`. The fee is
   * derived from the ~6-block Esplora rate against an estimated vsize, then a
   * change output is added back to the sender (omitted if below the dust
   * threshold). This does not do fee-rate iteration after change selection, so
   * the effective fee rate can drift slightly on multi-input spends.
   */
  async send(
    intent: TransferIntent,
    secret: ChainSecret,
    _opts?: SendOpts
  ): Promise<TxRef> {
    const priv = this.privKey(secret)
    const params = this.params()
    const from = getAddress('wpkh', priv, params)
    if (!from) {
      throw new PrismError('INTERNAL', 'Could not derive sender address.')
    }
    const spend = p2wpkh(secp256k1.getPublicKey(priv, true), params)

    const utxos = await this.esploraJson<EsploraUtxo[]>(`/address/${from}/utxo`)
    const confirmed = utxos
      .filter((u) => u.status.confirmed)
      .sort((a, b) => b.value - a.value)
    if (confirmed.length === 0) {
      throw new PrismError(
        'INSUFFICIENT_FUNDS',
        'No confirmed UTXOs available to spend.'
      )
    }

    const rate = await this.feeRate()
    const amount = intent.amountAtomic

    // Largest-first selection. Fee is recomputed from a vsize estimate that
    // grows with the number of selected inputs (~68 vB per P2WPKH input).
    const selected: EsploraUtxo[] = []
    let inputSum = 0n
    let fee = 0n
    for (const utxo of confirmed) {
      selected.push(utxo)
      inputSum += BigInt(utxo.value)
      const vsize = 11 + selected.length * 68 + 2 * 31
      fee = BigInt(Math.ceil(rate * vsize))
      if (inputSum >= amount + fee) break
    }

    if (inputSum < amount + fee) {
      throw new PrismError(
        'INSUFFICIENT_FUNDS',
        `Insufficient BTC: have ${this.satsToBtc(inputSum)}, need ${this.satsToBtc(amount + fee)} (incl. fee).`
      )
    }

    const tx = new Transaction()
    for (const utxo of selected) {
      tx.addInput({
        txid: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: spend.script,
          amount: BigInt(utxo.value)
        }
      })
    }
    tx.addOutputAddress(intent.to, amount, params)

    const change = inputSum - amount - fee
    // 546 sats is the standard P2WPKH dust threshold; drop change below it
    // (it is implicitly added to the fee).
    if (change > 546n) {
      tx.addOutputAddress(from, change, params)
    }

    tx.sign(priv)
    tx.finalize()

    const rawHex = bytesToHex(tx.extract())
    const txid = await this.broadcast(rawHex)
    return {
      hash: txid,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: txid })
    }
  }

  // ── message signing ──────────────────────────────────────────────────────

  /**
   * Sign `sha256(utf8(message))` with the account key over secp256k1 and return
   * a DER-encoded ECDSA signature (hex). Note: this is a plain ECDSA signature,
   * not a full BIP-322 / "Bitcoin Signed Message" proof.
   */
  async signMessage(
    message: string,
    secret: ChainSecret
  ): Promise<{ signature: string; scheme: string }> {
    const priv = this.privKey(secret)
    const digest = sha256(utf8ToBytes(message))
    const sig = secp256k1.sign(digest, priv)
    return { signature: sig.toDERHex(), scheme: 'ecdsa' }
  }

  // ── funding URI (BIP-21) ───────────────────────────────────────────────────

  buildFundingUri(req: {
    address: string
    asset: AssetRef
    amountAtomic?: bigint
    note?: string
  }): string {
    const { address, amountAtomic } = req
    const amount =
      amountAtomic !== undefined
        ? `?amount=${this.satsToBtc(amountAtomic)}`
        : ''
    return `bitcoin:${address}${amount}`
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private params(): BitcoinChainParams {
    return this.net.params
  }

  /** Extract a 32-byte private key from a bitcoin-family secret. */
  private privKey(secret: ChainSecret): Uint8Array {
    if (secret.family !== 'bitcoin') {
      throw new PrismError(
        'NO_KEY_FOR_CHAIN',
        `Bitcoin adapter received a ${secret.family} secret.`
      )
    }
    if (secret.wif) {
      return WIF(this.params()).decode(secret.wif)
    }
    if (secret.seed) {
      if (secret.seed.length !== 32) {
        throw new PrismError(
          'INTERNAL',
          `Bitcoin seed must be a 32-byte private key (got ${secret.seed.length}).`
        )
      }
      return secret.seed
    }
    throw new PrismError(
      'NO_KEY_FOR_CHAIN',
      'Bitcoin secret has neither a WIF nor a seed.'
    )
  }

  /** Convert sats (bigint) to a fixed 8-dp BTC decimal string. */
  private satsToBtc(sats: bigint): string {
    const neg = sats < 0n
    const abs = neg ? -sats : sats
    const whole = abs / SATS_PER_BTC
    const frac = abs % SATS_PER_BTC
    const fracStr = frac.toString().padStart(8, '0')
    return `${neg ? '-' : ''}${whole}.${fracStr}`
  }

  /** Fetch the ~6-block confirmation fee rate (sat/vB) from Esplora. */
  private async feeRate(): Promise<number> {
    const estimates =
      await this.esploraJson<Record<string, number>>('/fee-estimates')
    const rate = estimates['6'] ?? estimates['3'] ?? estimates['1'] ?? 1
    return rate > 0 ? rate : 1
  }

  /** POST a raw transaction hex to Esplora; returns the broadcast txid. */
  private async broadcast(rawHex: string): Promise<string> {
    const res = await fetch(`${this.net.esploraUrl}/tx`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: rawHex
    })
    const text = await res.text()
    if (!res.ok) {
      throw new PrismError('PAYMENT_FAILED', `Broadcast failed: ${text}`, {
        status: res.status
      })
    }
    return text.trim()
  }

  private async esploraJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.net.esploraUrl}${path}`)
    if (!res.ok) {
      throw new PrismError(
        'INTERNAL',
        `Esplora request failed (${res.status}) for ${path}.`,
        { status: res.status }
      )
    }
    return (await res.json()) as T
  }
}
