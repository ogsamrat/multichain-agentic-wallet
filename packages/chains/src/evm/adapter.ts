import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  type Address,
  type PublicClient
} from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { normalize } from 'viem/ens'
import { PrismError } from '@prism/core'
import type { PaymentAccept, SignedPayment } from '@prism/protocol'
import type {
  AllowanceManaging,
  ChainAdapter,
  FundingUriBuilding,
  MessageSigning,
  NameResolving,
  X402Capable
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
import type { EvmNetwork } from './networks.js'
import { rpcOverride } from './networks.js'
import { evmX402Sign } from './x402.js'

const CAPS: Capability[] = [
  'native_transfer',
  'token_transfer',
  'token_balance',
  'name_resolution',
  'x402_pay',
  'allowance',
  'message_signing',
  'funding_uri'
]

/** One adapter instance serves one EVM network. */
export class EvmAdapter
  implements
    ChainAdapter,
    NameResolving,
    X402Capable,
    AllowanceManaging,
    MessageSigning,
    FundingUriBuilding
{
  readonly info: ChainInfo
  readonly capabilities: ReadonlySet<Capability> = new Set(CAPS)

  private readonly net: EvmNetwork
  private _public?: PublicClient
  private static _ensClient?: PublicClient

  constructor(net: EvmNetwork) {
    this.net = net
    this.info = {
      caip2: net.caip2,
      family: 'evm',
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
    this.assertEvm(secret)
    return privateKeyToAccount(secret.privateKey as `0x${string}`).address
  }

  // ── assets ───────────────────────────────────────────────────────────────

  private nativeAsset(): AssetRef {
    return {
      caip19: `${this.net.caip2}/slip44:60`,
      symbol: this.net.nativeSymbol,
      decimals: this.net.nativeDecimals,
      native: true
    }
  }

  private usdcAsset(): AssetRef | null {
    if (!this.net.usdc) return null
    return {
      caip19: `${this.net.caip2}/erc20:${this.net.usdc.address}`,
      symbol: 'USDC',
      decimals: this.net.usdc.decimals,
      native: false,
      reference: this.net.usdc.address
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
    if (isAddress(ref)) {
      try {
        const address = getAddress(ref)
        const pc = this.publicClient()
        const [decimals, symbol] = await Promise.all([
          pc.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
          pc.readContract({ address, abi: erc20Abi, functionName: 'symbol' })
        ])
        return {
          caip19: `${this.net.caip2}/erc20:${address}`,
          symbol: String(symbol),
          decimals: Number(decimals),
          native: false,
          reference: address
        }
      } catch {
        return null
      }
    }
    return null
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  async getNativeBalance(address: string): Promise<Balance> {
    const atomic = await this.publicClient().getBalance({
      address: getAddress(address)
    })
    const asset = this.nativeAsset()
    return { asset, atomic, human: formatUnits(atomic, asset.decimals) }
  }

  async getTokenBalances(
    address: string,
    assets?: AssetRef[]
  ): Promise<Balance[]> {
    const list = assets ?? (this.usdcAsset() ? [this.usdcAsset()!] : [])
    const pc = this.publicClient()
    const owner = getAddress(address)
    const balances: Balance[] = []
    for (const asset of list) {
      if (!asset.reference) continue
      try {
        const atomic = (await pc.readContract({
          address: asset.reference as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [owner]
        })) as bigint
        balances.push({
          asset,
          atomic,
          human: formatUnits(atomic, asset.decimals)
        })
      } catch {
        // skip unreadable token
      }
    }
    return balances
  }

  async getTxStatus(hash: string): Promise<TxStatus> {
    try {
      const receipt = await this.publicClient().getTransactionReceipt({
        hash: hash as `0x${string}`
      })
      return receipt.status === 'success' ? 'confirmed' : 'failed'
    } catch {
      // not yet mined or unknown
      try {
        await this.publicClient().getTransaction({
          hash: hash as `0x${string}`
        })
        return 'pending'
      } catch {
        return 'unknown'
      }
    }
  }

  explorerUrl(ref: {
    tx?: string
    address?: string
    asset?: string
  }): string | undefined {
    const base = this.net.explorerBase
    if (ref.tx) return `${base}/tx/${ref.tx}`
    if (ref.address) return `${base}/address/${ref.address}`
    if (ref.asset) return `${base}/token/${ref.asset}`
    return undefined
  }

  // ── fee / simulate ───────────────────────────────────────────────────────

  async estimateFee(intent: TransferIntent): Promise<FeeEstimate> {
    const gasPrice = await this.publicClient().getGasPrice()
    const gas = intent.asset.native ? 21_000n : 70_000n
    const atomic = gasPrice * gas
    const native = this.nativeAsset()
    return {
      asset: native,
      atomic,
      human: formatUnits(atomic, native.decimals),
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
          warnings.push('Native balance may not cover amount plus gas.')
        }
      } else {
        if (native.atomic < fee.atomic) {
          warnings.push('Native balance may not cover gas for this transfer.')
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
    opts?: SendOpts
  ): Promise<TxRef> {
    this.assertEvm(secret)
    const account = privateKeyToAccount(secret.privateKey as `0x${string}`)
    const wallet = createWalletClient({
      account,
      chain: this.net.viemChain,
      transport: this.transport()
    })
    const to = getAddress(intent.to)

    let hash: `0x${string}`
    if (intent.asset.native) {
      hash = await wallet.sendTransaction({
        account,
        chain: this.net.viemChain,
        to,
        value: intent.amountAtomic
      })
    } else {
      if (!intent.asset.reference) {
        throw new PrismError(
          'INTERNAL',
          'Token asset missing contract address.'
        )
      }
      hash = await wallet.writeContract({
        account,
        chain: this.net.viemChain,
        address: intent.asset.reference as Address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, intent.amountAtomic]
      })
    }

    if (opts?.waitForConfirmation) {
      await this.publicClient().waitForTransactionReceipt({ hash })
    }
    return {
      hash,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: hash })
    }
  }

  // ── x402 ─────────────────────────────────────────────────────────────────

  async x402Sign(
    accept: PaymentAccept,
    secret: ChainSecret
  ): Promise<SignedPayment> {
    this.assertEvm(secret)
    return evmX402Sign(this.net, accept, secret.privateKey)
  }

  x402BuildAccept(params: {
    asset: AssetRef
    payTo: string
    amountAtomic: bigint
    resource?: string
  }): PaymentAccept {
    const extra =
      this.net.usdcEip712 && params.asset.symbol === 'USDC'
        ? { ...this.net.usdcEip712 }
        : {}
    return {
      scheme: 'exact',
      network: this.net.caip2,
      asset: params.asset.reference ?? params.asset.symbol,
      payTo: params.payTo,
      amount: params.amountAtomic.toString(),
      maxTimeoutSeconds: 300,
      extra
    }
  }

  // ── allowances ─────────────────────────────────────────────────────────────

  async getAllowance(
    owner: string,
    spender: string,
    asset: AssetRef
  ): Promise<bigint> {
    if (!asset.reference) return 0n
    return (await this.publicClient().readContract({
      address: asset.reference as Address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [getAddress(owner), getAddress(spender)]
    })) as bigint
  }

  async setAllowance(
    spender: string,
    asset: AssetRef,
    amountAtomic: bigint,
    secret: ChainSecret
  ): Promise<TxRef> {
    this.assertEvm(secret)
    if (!asset.reference) {
      throw new PrismError('INTERNAL', 'Token asset missing contract address.')
    }
    const account = privateKeyToAccount(secret.privateKey as `0x${string}`)
    const wallet = createWalletClient({
      account,
      chain: this.net.viemChain,
      transport: this.transport()
    })
    const hash = await wallet.writeContract({
      account,
      chain: this.net.viemChain,
      address: asset.reference as Address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [getAddress(spender), amountAtomic]
    })
    return {
      hash,
      caip2: this.net.caip2,
      explorerUrl: this.explorerUrl({ tx: hash })
    }
  }

  // ── message signing ──────────────────────────────────────────────────────

  async signMessage(
    message: string,
    secret: ChainSecret
  ): Promise<{ signature: string; scheme: string }> {
    this.assertEvm(secret)
    const account = privateKeyToAccount(secret.privateKey as `0x${string}`)
    const signature = await account.signMessage({ message })
    return { signature, scheme: 'eip191' }
  }

  // ── funding URI (EIP-681) ─────────────────────────────────────────────────

  buildFundingUri(req: {
    address: string
    asset: AssetRef
    amountAtomic?: bigint
  }): string {
    const { address, asset, amountAtomic } = req
    if (asset.native) {
      const value = amountAtomic !== undefined ? `?value=${amountAtomic}` : ''
      return `ethereum:${address}@${this.net.chainId}${value}`
    }
    const amount = amountAtomic !== undefined ? `&uint256=${amountAtomic}` : ''
    return `ethereum:${asset.reference}@${this.net.chainId}/transfer?address=${address}${amount}`
  }

  // ── name resolution (ENS, on L1) ─────────────────────────────────────────

  isName(value: string): boolean {
    return value.trim().toLowerCase().endsWith('.eth')
  }

  async resolveName(name: string): Promise<string | null> {
    try {
      const addr = await EvmAdapter.ensClient().getEnsAddress({
        name: normalize(name)
      })
      return addr ?? null
    } catch {
      return null
    }
  }

  async lookupName(address: string): Promise<string | null> {
    try {
      const name = await EvmAdapter.ensClient().getEnsName({
        address: getAddress(address)
      })
      return name ?? null
    } catch {
      return null
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private transport() {
    const rpc = rpcOverride(this.net.chainId)
    return rpc ? http(rpc) : http()
  }

  private publicClient(): PublicClient {
    if (!this._public) {
      this._public = createPublicClient({
        chain: this.net.viemChain,
        transport: this.transport()
      }) as PublicClient
    }
    return this._public
  }

  private static ensClient(): PublicClient {
    if (!EvmAdapter._ensClient) {
      const rpc = rpcOverride(1)
      EvmAdapter._ensClient = createPublicClient({
        chain: mainnet,
        transport: rpc ? http(rpc) : http()
      }) as PublicClient
    }
    return EvmAdapter._ensClient
  }

  private assertEvm(
    secret: ChainSecret
  ): asserts secret is { family: 'evm'; privateKey: string } {
    if (secret.family !== 'evm') {
      throw new PrismError(
        'NO_KEY_FOR_CHAIN',
        `EVM adapter received a ${secret.family} secret.`
      )
    }
  }
}
