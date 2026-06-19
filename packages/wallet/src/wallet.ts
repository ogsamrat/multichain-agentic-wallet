import {
  PrismError,
  PolicyDeniedError,
  UnsupportedCapabilityError
} from '@prism/core'
import { Amount } from '@prism/protocol'
import {
  AdapterRegistry,
  createDefaultAdapters,
  isAllowanceManaging,
  isFundingUriBuilding,
  isInvoicing,
  isMessageSigning,
  isNameResolving,
  isX402Capable,
  type Balance,
  type ChainAdapter
} from '@prism/chains'
import { resolveConfig, type PrismRuntimeConfig } from './config.js'
import { Keyring } from './keyring/keyring.js'
import { generateMnemonic, isValidMnemonic } from './keyring/hd.js'
import { writeFileConfig } from './keyring/keystore.js'
import { FileLedger } from './ledger/file.js'
import type { Ledger } from './ledger/ledger.js'
import { DEFAULT_POLICY, type SpendingPolicy } from './policy/policy.js'
import { PolicyEngine } from './policy/engine.js'
import { PaymentEngine, type FetchOptions } from './payment/engine.js'
import { IndexClient, type DiscoverQuery } from './discovery/index-client.js'

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'PYUSD', 'USDP', 'GUSD'])

function usdValue(symbol: string, amountDecimal: string): number {
  return STABLES.has(symbol.toUpperCase()) ? parseFloat(amountDecimal) : 0
}

function fmtBalance(b: Balance) {
  return {
    symbol: b.asset.symbol,
    amount: b.human,
    atomic: b.atomic.toString(),
    asset: b.asset.caip19
  }
}

export interface CreateWalletOptions {
  config?: PrismRuntimeConfig
  ledger?: Ledger
  adapters?: ChainAdapter[]
}

/**
 * The single high-level wallet interface. Every value-moving method routes
 * through the policy engine and durable ledger, so the MCP server, CLI, and SDK
 * all share identical guarantees.
 */
export class Wallet {
  readonly registry: AdapterRegistry
  readonly keyring: Keyring
  readonly policy: PolicyEngine
  readonly ledger: Ledger
  readonly payments: PaymentEngine
  readonly index: IndexClient
  readonly config: PrismRuntimeConfig

  constructor(opts: CreateWalletOptions = {}) {
    this.config = opts.config ?? resolveConfig()
    this.ledger = opts.ledger ?? new FileLedger()
    if (!this.ledger.getPolicy()) {
      this.ledger.setPolicy({ ...DEFAULT_POLICY, ...this.config.policyFromEnv })
    }
    this.registry = new AdapterRegistry().registerAll(
      opts.adapters ?? createDefaultAdapters()
    )
    this.keyring = new Keyring({
      env: this.config.env,
      startUnlocked: this.config.hasEnvKey
    })
    this.policy = new PolicyEngine(this.ledger)
    this.payments = new PaymentEngine(
      this.registry,
      this.keyring,
      this.policy,
      this.ledger
    )
    this.index = new IndexClient(this.config.indexUrl)
  }

  // ── identity / chains ────────────────────────────────────────────────────

  async listChains() {
    const out = []
    for (const a of this.registry.list()) {
      const configured = this.keyring.hasFamily(a.info.family)
      let address: string | undefined
      if (configured && !this.keyring.locked) {
        try {
          address = await a.deriveAddress(this.keyring.secretFor(a.info.family))
        } catch {
          /* leave undefined */
        }
      }
      out.push({
        caip2: a.info.caip2,
        name: a.info.displayName,
        family: a.info.family,
        aliases: a.info.aliases,
        testnet: a.info.testnet,
        capabilities: [...a.capabilities],
        configured,
        address
      })
    }
    return out
  }

  async getAddress(chain: string): Promise<string> {
    const a = this.registry.require(chain)
    return a.deriveAddress(this.keyring.secretFor(a.info.family))
  }

  // ── balances ─────────────────────────────────────────────────────────────

  async getBalances(chain: string) {
    const a = this.registry.require(chain)
    const address = await a.deriveAddress(this.keyring.secretFor(a.info.family))
    const [native, tokens] = await Promise.all([
      a.getNativeBalance(address),
      a.getTokenBalances(address)
    ])
    return {
      chain: a.info.caip2,
      name: a.info.displayName,
      address,
      native: fmtBalance(native),
      tokens: tokens.map(fmtBalance)
    }
  }

  async getPortfolio(chains?: string[]) {
    const targets = chains?.length
      ? chains.map((c) => this.registry.require(c))
      : this.registry
          .list()
          .filter((a) => this.keyring.hasFamily(a.info.family))
    const results = []
    for (const a of targets) {
      try {
        results.push(await this.getBalances(a.info.caip2))
      } catch (err) {
        results.push({
          chain: a.info.caip2,
          name: a.info.displayName,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return results
  }

  // ── transfers ──────────────────────────────────────────────────────────────

  private async resolveRecipient(a: ChainAdapter, to: string): Promise<string> {
    if (isNameResolving(a) && a.isName(to)) {
      const resolved = await a.resolveName(to)
      if (!resolved) {
        throw new PrismError(
          'NAME_RESOLUTION_FAILED',
          `Could not resolve name "${to}".`
        )
      }
      return resolved
    }
    return to
  }

  async send(input: {
    chain: string
    to: string
    amount: string
    asset?: string
    memo?: string
  }) {
    const a = this.registry.require(input.chain)
    const asset = await a.resolveAsset(input.asset ?? 'native')
    if (!asset)
      throw new PrismError('INTERNAL', `Unknown asset "${input.asset}".`)
    const to = await this.resolveRecipient(a, input.to)
    const amountAtomic = Amount.fromDecimal(input.amount, asset.decimals).atomic
    const amountUsd = usdValue(asset.symbol, input.amount)

    this.guardPolicy({
      kind: 'transfer',
      caip2: a.info.caip2,
      amountUsd,
      to
    })

    const secret = this.keyring.secretFor(a.info.family)
    const tx = await a.send(
      { asset, to, amountAtomic, memo: input.memo },
      secret,
      { waitForConfirmation: true }
    )
    this.ledger.recordSpend({
      kind: 'transfer',
      caip2: a.info.caip2,
      assetCaip19: asset.caip19,
      amountAtomic: amountAtomic.toString(),
      amountUsd,
      to,
      txHash: tx.hash,
      status: 'recorded'
    })
    return {
      tx,
      asset: asset.symbol,
      amount: input.amount,
      to,
      resolvedFrom: to !== input.to ? input.to : undefined
    }
  }

  // ── x402 ───────────────────────────────────────────────────────────────────

  async pay(input: {
    amount: string
    recipient: string
    chain: string
    asset?: string
    resource?: string
  }) {
    const a = this.registry.require(input.chain)
    if (!isX402Capable(a) || !a.x402BuildAccept) {
      throw new UnsupportedCapabilityError('x402_pay', a.info.caip2)
    }
    const asset = await a.resolveAsset(input.asset ?? 'usdc')
    if (!asset)
      throw new PrismError('INTERNAL', `Unknown asset "${input.asset}".`)
    const to = await this.resolveRecipient(a, input.recipient)
    const amountAtomic = Amount.fromDecimal(input.amount, asset.decimals).atomic
    const amountUsd = usdValue(asset.symbol, input.amount)

    this.guardPolicy({
      kind: 'x402',
      caip2: a.info.caip2,
      amountUsd,
      to,
      domain: input.resource
    })

    const accept = a.x402BuildAccept({
      asset,
      payTo: to,
      amountAtomic,
      resource: input.resource
    })
    const secret = this.keyring.secretFor(a.info.family)
    const signed = await a.x402Sign(accept, secret)
    const receipt = this.ledger.recordReceipt({
      resourceUrl: input.resource,
      caip2: a.info.caip2,
      scheme: accept.scheme,
      assetCaip19: asset.caip19,
      amountAtomic: amountAtomic.toString(),
      amountUsd,
      payTo: to,
      headerName: signed.headerName,
      status: 'signed'
    })
    return {
      headerName: signed.headerName,
      headerValue: signed.headerValue,
      amount: input.amount,
      asset: asset.symbol,
      recipient: to,
      chain: a.info.caip2,
      resource: input.resource,
      receiptId: receipt.id
    }
  }

  async x402Fetch(url: string, opts: FetchOptions = {}) {
    return this.payments.fetch(url, opts)
  }

  // ── allowances ───────────────────────────────────────────────────────────

  async getAllowance(chain: string, spender: string, asset: string) {
    const a = this.registry.require(chain)
    if (!isAllowanceManaging(a)) {
      throw new UnsupportedCapabilityError('allowance', a.info.caip2)
    }
    const assetRef = await a.resolveAsset(asset)
    if (!assetRef) throw new PrismError('INTERNAL', `Unknown asset "${asset}".`)
    const owner = await this.getAddress(chain)
    const value = await a.getAllowance(owner, spender, assetRef)
    return {
      owner,
      spender,
      asset: assetRef.symbol,
      atomic: value.toString(),
      amount: Amount.fromAtomic(value, assetRef.decimals).toDecimal()
    }
  }

  async setAllowance(input: {
    chain: string
    spender: string
    asset: string
    amount: string
  }) {
    const a = this.registry.require(input.chain)
    if (!isAllowanceManaging(a)) {
      throw new UnsupportedCapabilityError('allowance', a.info.caip2)
    }
    const assetRef = await a.resolveAsset(input.asset)
    if (!assetRef)
      throw new PrismError('INTERNAL', `Unknown asset "${input.asset}".`)
    const amountAtomic = Amount.fromDecimal(
      input.amount,
      assetRef.decimals
    ).atomic
    this.guardPolicy({
      kind: 'allowance',
      caip2: a.info.caip2,
      amountUsd: 0,
      to: input.spender
    })
    const secret = this.keyring.secretFor(a.info.family)
    const tx = await a.setAllowance(
      input.spender,
      assetRef,
      amountAtomic,
      secret
    )
    return {
      tx,
      spender: input.spender,
      asset: assetRef.symbol,
      amount: input.amount
    }
  }

  // ── misc capabilities ─────────────────────────────────────────────────────

  async resolveName(chain: string, name: string) {
    const a = this.registry.require(chain)
    if (!isNameResolving(a)) {
      throw new UnsupportedCapabilityError('name_resolution', a.info.caip2)
    }
    const address = a.isName(name) ? await a.resolveName(name) : name
    return { name, address }
  }

  async signMessage(chain: string, message: string) {
    const a = this.registry.require(chain)
    if (!isMessageSigning(a)) {
      throw new UnsupportedCapabilityError('message_signing', a.info.caip2)
    }
    const secret = this.keyring.secretFor(a.info.family)
    return a.signMessage(message, secret)
  }

  async requestFunding(input: {
    chain: string
    asset?: string
    amount?: string
    note?: string
  }) {
    const a = this.registry.require(input.chain)
    if (!isFundingUriBuilding(a)) {
      throw new UnsupportedCapabilityError('funding_uri', a.info.caip2)
    }
    const asset = await a.resolveAsset(input.asset ?? 'native')
    if (!asset)
      throw new PrismError('INTERNAL', `Unknown asset "${input.asset}".`)
    const address = await this.getAddress(input.chain)
    const amountAtomic =
      input.amount !== undefined
        ? Amount.fromDecimal(input.amount, asset.decimals).atomic
        : undefined
    const uri = a.buildFundingUri({ address, asset, amountAtomic })
    return {
      uri,
      address,
      asset: asset.symbol,
      amount: input.amount,
      chain: a.info.caip2
    }
  }

  // ── lightning invoicing ────────────────────────────────────────────────────

  async createInvoice(input: {
    chain: string
    amount?: string
    memo?: string
    expirySeconds?: number
  }) {
    const a = this.registry.require(input.chain)
    if (!isInvoicing(a)) {
      throw new UnsupportedCapabilityError('invoicing', a.info.caip2)
    }
    const asset = a.info.nativeAsset
    const amountAtomic =
      input.amount !== undefined
        ? Amount.fromDecimal(input.amount, asset.decimals).atomic
        : undefined
    const secret = this.keyring.secretFor(a.info.family)
    const res = await a.createInvoice(
      { amountAtomic, memo: input.memo, expirySeconds: input.expirySeconds },
      secret
    )
    return { ...res, chain: a.info.caip2 }
  }

  async payInvoice(input: { chain: string; invoice: string; maxFee?: string }) {
    const a = this.registry.require(input.chain)
    if (!isInvoicing(a)) {
      throw new UnsupportedCapabilityError('invoicing', a.info.caip2)
    }
    const asset = a.info.nativeAsset
    const decoded = await a.decodeInvoice(input.invoice)
    this.guardPolicy({
      kind: 'invoice_pay',
      caip2: a.info.caip2,
      amountUsd: 0,
      to: decoded.payee
    })
    const secret = this.keyring.secretFor(a.info.family)
    const maxFeeAtomic =
      input.maxFee !== undefined
        ? Amount.fromDecimal(input.maxFee, asset.decimals).atomic
        : undefined
    const res = await a.payInvoice(input.invoice, secret, { maxFeeAtomic })
    this.ledger.recordSpend({
      kind: 'invoice_pay',
      caip2: a.info.caip2,
      assetCaip19: asset.caip19,
      amountAtomic: String(decoded.amountAtomic ?? 0n),
      amountUsd: 0,
      to: decoded.payee,
      txHash: res.preimage,
      status: 'recorded'
    })
    return { ...res, chain: a.info.caip2, decoded }
  }

  async simulate(input: {
    chain: string
    to: string
    amount: string
    asset?: string
  }) {
    const a = this.registry.require(input.chain)
    const asset = await a.resolveAsset(input.asset ?? 'native')
    if (!asset)
      throw new PrismError('INTERNAL', `Unknown asset "${input.asset}".`)
    const from = await this.getAddress(input.chain)
    const to = await this.resolveRecipient(a, input.to)
    const amountAtomic = Amount.fromDecimal(input.amount, asset.decimals).atomic
    const result = await a.simulate({ asset, to, amountAtomic }, from)
    return {
      ok: result.ok,
      warnings: result.warnings,
      fee: result.fee
        ? { amount: result.fee.human, symbol: result.fee.asset.symbol }
        : undefined
    }
  }

  async getTxStatus(chain: string, hash: string) {
    const a = this.registry.require(chain)
    const status = await a.getTxStatus(hash)
    return { hash, status, explorerUrl: a.explorerUrl({ tx: hash }) }
  }

  // ── discovery ──────────────────────────────────────────────────────────────

  async discoverServices(query: DiscoverQuery) {
    if (!this.index.configured) {
      return {
        configured: false,
        note: 'Set PRISM_INDEX_URL to query the Prism Index registry.',
        results: []
      }
    }
    const results = await this.index.search(query)
    return { configured: true, count: results.length, results }
  }

  // ── policy / reporting ─────────────────────────────────────────────────────

  getPolicy(): SpendingPolicy {
    return this.policy.policy
  }

  setPolicy(patch: Partial<SpendingPolicy>): SpendingPolicy {
    const next = { ...this.policy.policy, ...patch }
    this.policy.setPolicy(next)
    return next
  }

  confirmAction(token: string) {
    this.policy.confirm(token)
    return { confirmed: true, token }
  }

  getSpendingReport() {
    const policy = this.policy.policy
    const spentToday = this.ledger.spentTodayUsd()
    return {
      spentTodayUsd: spentToday.toFixed(4),
      remainingTodayUsd: Math.max(
        0,
        parseFloat(policy.maxPerDayUsd) - spentToday
      ).toFixed(4),
      policy,
      recentSpends: this.ledger.recentSpends(10),
      recentReceipts: this.ledger.recentReceipts(10)
    }
  }

  listReceipts(limit = 20) {
    return this.ledger.recentReceipts(limit)
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async initWallet(input: {
    mnemonic?: string
    passphrase: string
    generate?: boolean
  }) {
    let mnemonic = input.mnemonic
    let generated = false
    if (!mnemonic) {
      if (!input.generate) {
        throw new PrismError(
          'CONFIG_ERROR',
          'Provide a mnemonic or set generate=true to create a new wallet.'
        )
      }
      mnemonic = generateMnemonic()
      generated = true
    }
    if (!isValidMnemonic(mnemonic)) {
      throw new PrismError('CONFIG_ERROR', 'Invalid BIP-39 mnemonic.')
    }
    Keyring.create({ mnemonic }, input.passphrase)
    this.keyring.unlock(input.passphrase)
    writeFileConfig({ createdAt: new Date().toISOString() })
    const chains = await this.listChains()
    return {
      created: true,
      mnemonic: generated ? mnemonic : undefined,
      warning: generated
        ? 'Write down this recovery phrase now. It is shown only once.'
        : undefined,
      addresses: chains
        .filter((c) => c.address)
        .map((c) => ({
          chain: c.caip2,
          address: c.address
        }))
    }
  }

  unlock(passphrase: string) {
    this.keyring.unlock(passphrase)
    return { unlocked: true }
  }

  lock() {
    this.keyring.lock()
    return { locked: true }
  }

  get locked(): boolean {
    return this.keyring.locked
  }

  private guardPolicy(action: {
    kind:
      | 'transfer'
      | 'x402'
      | 'allowance'
      | 'swap'
      | 'token_issue'
      | 'invoice_pay'
    caip2: string
    amountUsd: number
    to?: string
    domain?: string
  }): void {
    const decision = this.policy.authorize(action)
    if (decision.allow === false) {
      throw new PolicyDeniedError(decision.reason)
    }
    if (decision.allow === 'needs_confirmation') {
      throw new PrismError('NEEDS_CONFIRMATION', decision.reason, {
        token: decision.token
      })
    }
  }
}

/** Construct a ready-to-use wallet from environment configuration. */
export function createWallet(opts?: CreateWalletOptions): Wallet {
  return new Wallet(opts)
}
