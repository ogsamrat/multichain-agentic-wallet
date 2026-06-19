import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createMint,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  mintTo
} from '@solana/spl-token'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { PrismError } from '@prism/core'
import type {
  ChainAdapter,
  FundingUriBuilding,
  MessageSigning,
  TokenIssuing,
  TokenSpec
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
import type { SolanaNetwork } from './networks.js'
import { rpcOverride } from './networks.js'

// NOTE: There is no x402 scheme installed for Solana, so this adapter does NOT
// implement X402Capable and omits 'x402_pay'. Solana x402 support will be added
// when an SVM x402 scheme becomes available.
const CAPS: Capability[] = [
  'native_transfer',
  'token_transfer',
  'token_balance',
  'message_signing',
  'funding_uri',
  'token_issuance'
]

/** A flat fee estimate (lamports). Solana base fee is ~5000 lamports/signature. */
const BASE_FEE_LAMPORTS = 5000n

/** One adapter instance serves one Solana (SVM) network. */
export class SolanaAdapter
  implements ChainAdapter, MessageSigning, FundingUriBuilding, TokenIssuing
{
  readonly info: ChainInfo
  readonly capabilities: ReadonlySet<Capability> = new Set(CAPS)

  private readonly net: SolanaNetwork
  private _connection?: Connection

  constructor(net: SolanaNetwork) {
    this.net = net
    this.info = {
      caip2: net.caip2,
      family: 'svm',
      accountModel: 'account',
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
    return this.keypair(secret).publicKey.toBase58()
  }

  // ── assets ───────────────────────────────────────────────────────────────

  private nativeAsset(): AssetRef {
    return {
      caip19: `${this.net.caip2}/slip44:501`,
      symbol: this.net.nativeSymbol,
      decimals: this.net.nativeDecimals,
      native: true
    }
  }

  private usdcAsset(): AssetRef {
    return {
      caip19: `${this.net.caip2}/token:${this.net.usdcMint}`,
      symbol: 'USDC',
      decimals: this.net.usdcDecimals,
      native: false,
      reference: this.net.usdcMint
    }
  }

  private tokenAsset(
    mint: string,
    decimals: number,
    symbol: string,
    name?: string
  ): AssetRef {
    return {
      caip19: `${this.net.caip2}/token:${mint}`,
      symbol,
      decimals,
      native: false,
      reference: mint,
      ...(name ? { name } : {})
    }
  }

  async resolveAsset(ref: string): Promise<AssetRef | null> {
    const lower = ref.trim().toLowerCase()
    if (
      lower === 'native' ||
      lower === 'gas' ||
      lower === this.net.nativeSymbol.toLowerCase()
    ) {
      return this.nativeAsset()
    }
    if (lower === 'usdc') return this.usdcAsset()
    // Otherwise treat as a base58 mint address.
    let mint: PublicKey
    try {
      mint = new PublicKey(ref.trim())
    } catch {
      return null
    }
    try {
      const info = await getMint(this.connection(), mint)
      // SPL mints carry no on-chain symbol; use a best-effort short label.
      const base58 = mint.toBase58()
      const symbol =
        base58.length > 8
          ? `${base58.slice(0, 4)}…${base58.slice(-4)}`
          : 'TOKEN'
      return this.tokenAsset(base58, info.decimals, symbol)
    } catch {
      return null
    }
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  async getNativeBalance(address: string): Promise<Balance> {
    const lamports = await this.connection().getBalance(new PublicKey(address))
    const atomic = BigInt(lamports)
    const asset = this.nativeAsset()
    return { asset, atomic, human: this.formatUnits(atomic, asset.decimals) }
  }

  async getTokenBalances(
    address: string,
    assets?: AssetRef[]
  ): Promise<Balance[]> {
    const list = assets ?? [this.usdcAsset()]
    const owner = new PublicKey(address)
    const conn = this.connection()
    const balances: Balance[] = []
    for (const asset of list) {
      if (!asset.reference) continue
      try {
        const mint = new PublicKey(asset.reference)
        const ata = await getAssociatedTokenAddress(mint, owner)
        let atomic = 0n
        try {
          const account = await getAccount(conn, ata)
          atomic = account.amount
        } catch {
          // No associated token account yet → zero balance.
          atomic = 0n
        }
        balances.push({
          asset,
          atomic,
          human: this.formatUnits(atomic, asset.decimals)
        })
      } catch {
        // skip unreadable token
      }
    }
    return balances
  }

  async getTxStatus(hash: string): Promise<TxStatus> {
    try {
      const { value } = await this.connection().getSignatureStatus(hash, {
        searchTransactionHistory: true
      })
      if (!value) return 'unknown'
      if (value.err) return 'failed'
      const status = value.confirmationStatus
      if (status === 'confirmed' || status === 'finalized') return 'confirmed'
      return 'pending'
    } catch {
      return 'unknown'
    }
  }

  explorerUrl(ref: {
    tx?: string
    address?: string
    asset?: string
  }): string | undefined {
    const base = this.net.explorer
    const suffix = this.net.explorerCluster
      ? `?cluster=${this.net.explorerCluster}`
      : ''
    if (ref.tx) return `${base}/tx/${ref.tx}${suffix}`
    if (ref.address) return `${base}/address/${ref.address}${suffix}`
    if (ref.asset) return `${base}/address/${ref.asset}${suffix}`
    return undefined
  }

  // ── fee / simulate ───────────────────────────────────────────────────────

  async estimateFee(intent: TransferIntent): Promise<FeeEstimate> {
    // Solana fees are tiny and roughly fixed per signature. A non-native
    // transfer may need to create a destination ATA, but for estimation we
    // surface the base signature fee as a SOL FeeEstimate.
    const native = this.nativeAsset()
    return {
      asset: native,
      atomic: BASE_FEE_LAMPORTS,
      human: this.formatUnits(BASE_FEE_LAMPORTS, native.decimals),
      tier: intent.feeTier ?? 'normal'
    }
  }

  async simulate(intent: TransferIntent, from: string): Promise<SimResult> {
    const warnings: string[] = []
    const fee = await this.estimateFee(intent)
    try {
      const native = await this.getNativeBalance(from)
      if (intent.asset.native) {
        if (native.atomic < intent.amountAtomic + fee.atomic) {
          warnings.push('SOL balance may not cover amount plus fee.')
        }
      } else {
        if (native.atomic < fee.atomic) {
          warnings.push('SOL balance may not cover the transaction fee.')
        }
        const [bal] = await this.getTokenBalances(from, [intent.asset])
        if (!bal || bal.atomic < intent.amountAtomic) {
          warnings.push('Token balance may be insufficient.')
        }
      }
    } catch {
      warnings.push('Could not read balances for simulation.')
    }
    return { ok: warnings.length === 0, fee, warnings }
  }

  // ── send ─────────────────────────────────────────────────────────────────

  async send(
    intent: TransferIntent,
    secret: ChainSecret,
    _opts?: SendOpts
  ): Promise<TxRef> {
    const payer = this.keypair(secret)
    const conn = this.connection()
    const to = new PublicKey(intent.to)
    const tx = new Transaction()

    if (intent.asset.native) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: to,
          lamports: intent.amountAtomic
        })
      )
    } else {
      if (!intent.asset.reference) {
        throw new PrismError('INTERNAL', 'Token asset missing mint address.')
      }
      const mint = new PublicKey(intent.asset.reference)
      const sourceAta = await getAssociatedTokenAddress(mint, payer.publicKey)
      const destAta = await getAssociatedTokenAddress(mint, to)

      // Create the destination ATA if it does not exist yet.
      try {
        await getAccount(conn, destAta)
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            payer.publicKey, // payer
            destAta, // ata
            to, // owner
            mint
          )
        )
      }

      tx.add(
        createTransferInstruction(
          sourceAta,
          destAta,
          payer.publicKey,
          intent.amountAtomic
        )
      )
    }

    // sendAndConfirmTransaction always waits for confirmation (it is the only
    // way to obtain a confirmed signature on Solana); SendOpts.waitForConfirmation
    // is therefore implicitly honoured.
    const signature = await sendAndConfirmTransaction(conn, tx, [payer], {
      commitment: 'confirmed'
    })

    return {
      hash: signature,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: signature })
    }
  }

  // ── message signing (ed25519) ──────────────────────────────────────────────

  async signMessage(
    message: string,
    secret: ChainSecret
  ): Promise<{ signature: string; scheme: string }> {
    const keypair = this.keypair(secret)
    const bytes = new TextEncoder().encode(message)
    const sig = nacl.sign.detached(bytes, keypair.secretKey)
    return { signature: bs58.encode(sig), scheme: 'ed25519' }
  }

  // ── funding URI (Solana Pay) ────────────────────────────────────────────────

  buildFundingUri(req: {
    address: string
    asset: AssetRef
    amountAtomic?: bigint
    note?: string
  }): string {
    const { address, asset, amountAtomic, note } = req
    const params: string[] = []
    if (amountAtomic !== undefined) {
      params.push(`amount=${this.formatUnits(amountAtomic, asset.decimals)}`)
    }
    if (!asset.native && asset.reference) {
      params.push(`spl-token=${asset.reference}`)
    }
    if (note) params.push(`memo=${encodeURIComponent(note)}`)
    const query = params.length ? `?${params.join('&')}` : ''
    return `solana:${address}${query}`
  }

  // ── token issuance (SPL mint) ───────────────────────────────────────────────

  async issueToken(
    spec: TokenSpec,
    secret: ChainSecret
  ): Promise<{ asset: AssetRef; tx: TxRef }> {
    const payer = this.keypair(secret)
    const conn = this.connection()

    // Create a new SPL mint with the creator as mint + freeze authority.
    const mint = await createMint(
      conn,
      payer, // payer / fee payer
      payer.publicKey, // mint authority
      payer.publicKey, // freeze authority
      spec.decimals
    )

    // Mint the full supply into the creator's associated token account.
    const ata = await getAssociatedTokenAddress(mint, payer.publicKey)
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        payer.publicKey,
        mint
      )
    )
    await sendAndConfirmTransaction(conn, tx, [payer], {
      commitment: 'confirmed'
    })

    const signature = await mintTo(
      conn,
      payer,
      mint,
      ata,
      payer.publicKey,
      spec.totalSupply
    )

    const asset = this.tokenAsset(
      mint.toBase58(),
      spec.decimals,
      spec.symbol,
      spec.name
    )
    return {
      asset,
      tx: {
        hash: signature,
        caip2: this.net.caip2,
        explorerUrl: this.explorerUrl({ tx: signature })
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private keypair(secret: ChainSecret): Keypair {
    this.assertSvm(secret)
    if (secret.secretKey) return Keypair.fromSecretKey(secret.secretKey)
    if (secret.seed) return Keypair.fromSeed(secret.seed)
    throw new PrismError(
      'NO_KEY_FOR_CHAIN',
      'Solana secret has neither a secretKey nor a seed.'
    )
  }

  private connection(): Connection {
    if (!this._connection) {
      const rpc = rpcOverride(this.net.caip2) ?? this.net.rpcUrl
      this._connection = new Connection(rpc, 'confirmed')
    }
    return this._connection
  }

  /** Format atomic units (bigint) into a human decimal string. */
  private formatUnits(atomic: bigint, decimals: number): string {
    if (decimals === 0) return atomic.toString()
    const negative = atomic < 0n
    const abs = negative ? -atomic : atomic
    const base = 10n ** BigInt(decimals)
    const whole = abs / base
    const frac = abs % base
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    const sign = negative ? '-' : ''
    return fracStr ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`
  }

  private assertSvm(secret: ChainSecret): asserts secret is {
    family: 'svm'
    secretKey?: Uint8Array
    seed?: Uint8Array
  } {
    if (secret.family !== 'svm') {
      throw new PrismError(
        'NO_KEY_FOR_CHAIN',
        `Solana adapter received a ${secret.family} secret.`
      )
    }
  }
}
