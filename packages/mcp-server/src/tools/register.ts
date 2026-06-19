import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Wallet } from '@prism/wallet'
import { run } from './util.js'

/**
 * Register the full Prism tool surface on an MCP server. Tools are thin: each
 * validates input and delegates to the shared {@link Wallet} facade, where all
 * policy and ledger guarantees live.
 */
export function registerAllTools(server: McpServer, wallet: Wallet): void {
  // ── Wallet & identity ────────────────────────────────────────────────────
  server.tool(
    'list_chains',
    'List every supported chain with its capabilities, whether a key is configured, and the wallet address.',
    {},
    () => run(() => wallet.listChains())
  )

  server.tool(
    'get_address',
    'Get the wallet address for a chain (alias like "base" or a CAIP-2 id).',
    { chain: z.string().describe('Chain alias or CAIP-2 id, e.g. "base"') },
    ({ chain }) =>
      run(async () => ({ chain, address: await wallet.getAddress(chain) }))
  )

  server.tool(
    'init_wallet',
    'Create an encrypted keystore from a new or existing recovery phrase. Returns the addresses; if generated, shows the phrase once.',
    {
      passphrase: z.string().describe('Passphrase that encrypts the keystore'),
      mnemonic: z
        .string()
        .optional()
        .describe('Existing BIP-39 phrase to import'),
      generate: z
        .boolean()
        .optional()
        .describe('Generate a new phrase if none given')
    },
    (args) => run(() => wallet.initWallet(args))
  )

  server.tool(
    'unlock_wallet',
    'Unlock the encrypted keystore for this session.',
    { passphrase: z.string().describe('Keystore passphrase') },
    ({ passphrase }) => run(() => wallet.unlock(passphrase))
  )

  server.tool(
    'lock_wallet',
    'Lock the wallet, clearing secrets from memory.',
    {},
    () => run(() => wallet.lock())
  )

  // ── Portfolio & balances ───────────────────────────────────────────────────
  server.tool(
    'get_balances',
    'Get native and token balances for one chain.',
    { chain: z.string().describe('Chain alias or CAIP-2 id') },
    ({ chain }) => run(() => wallet.getBalances(chain))
  )

  server.tool(
    'get_portfolio',
    'Get balances across all configured chains (optionally a subset).',
    {
      chains: z.array(z.string()).optional().describe('Limit to these chains')
    },
    ({ chains }) => run(() => wallet.getPortfolio(chains))
  )

  server.tool(
    'get_token_info',
    'Resolve a token symbol or contract address into its asset details on a chain.',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      asset: z.string().describe('Symbol (e.g. "USDC") or contract address')
    },
    ({ chain, asset }) =>
      run(async () => {
        const adapter = wallet.registry.require(chain)
        const ref = await adapter.resolveAsset(asset)
        if (!ref)
          throw new Error(`Could not resolve asset "${asset}" on ${chain}.`)
        return ref
      })
  )

  // ── Send & receive ─────────────────────────────────────────────────────────
  server.tool(
    'send',
    'Send native gas or a token to an address (or resolvable name). Waits for confirmation.',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      to: z.string().describe('Recipient address or name (e.g. "alice.eth")'),
      amount: z.string().describe('Decimal amount, e.g. "1.5"'),
      asset: z
        .string()
        .optional()
        .describe('Asset symbol/address; defaults to native'),
      memo: z.string().optional().describe('Optional memo, where supported')
    },
    (args) => run(() => wallet.send(args))
  )

  server.tool(
    'request_funding',
    'Build a payment-request deep link (EIP-681 / BIP-21 / etc.) to top up this wallet.',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      asset: z
        .string()
        .optional()
        .describe('Asset to request; defaults to native'),
      amount: z.string().optional().describe('Optional requested amount'),
      note: z.string().optional().describe('Optional note')
    },
    (args) => run(() => wallet.requestFunding(args))
  )

  server.tool(
    'resolve_name',
    'Resolve a human-readable name (ENS, etc.) to an address on a chain.',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      name: z.string().describe('Name to resolve, e.g. "vitalik.eth"')
    },
    ({ chain, name }) => run(() => wallet.resolveName(chain, name))
  )

  // ── x402 agentic payments ──────────────────────────────────────────────────
  server.tool(
    'pay',
    'Sign an x402 payment authorization and return the payment header to attach to an HTTP request.',
    {
      amount: z.string().describe('Decimal amount, e.g. "0.05"'),
      recipient: z.string().describe('Recipient address'),
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      asset: z
        .string()
        .optional()
        .describe('Asset symbol/address; defaults to USDC'),
      resource: z
        .string()
        .optional()
        .describe('URL of the resource being paid for')
    },
    (args) => run(() => wallet.pay(args))
  )

  server.tool(
    'x402_fetch',
    'Fetch a URL, automatically paying any HTTP 402 by negotiating the best fulfillable option and retrying.',
    {
      url: z.string().url().describe('URL to fetch'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
        .optional()
        .describe('HTTP method (default GET)'),
      headers: z
        .record(z.string())
        .optional()
        .describe('Optional request headers'),
      body: z.string().optional().describe('Optional request body'),
      prefer: z
        .enum(['cheapest', 'fastest', 'preferred-chain'])
        .optional()
        .describe('How to pick among accepted payment options'),
      maxAmountUsd: z
        .number()
        .optional()
        .describe('Refuse to pay above this USD amount')
    },
    ({ url, ...opts }) => run(() => wallet.x402Fetch(url, opts))
  )

  server.tool(
    'list_receipts',
    'List recent x402 payment receipts.',
    {
      limit: z
        .number()
        .optional()
        .describe('Max receipts to return (default 20)')
    },
    ({ limit }) => run(() => wallet.listReceipts(limit))
  )

  // ── Lightning invoicing ─────────────────────────────────────────────────────
  server.tool(
    'create_invoice',
    'Create a Lightning invoice (bolt11) to receive a payment.',
    {
      chain: z.string().describe('Lightning chain alias, e.g. "lightning"'),
      amount: z
        .string()
        .optional()
        .describe('Amount in sats (omit for any-amount)'),
      memo: z.string().optional().describe('Optional invoice memo'),
      expirySeconds: z.number().optional().describe('Invoice expiry in seconds')
    },
    (args) => run(() => wallet.createInvoice(args))
  )

  server.tool(
    'pay_invoice',
    'Pay a Lightning invoice (bolt11), subject to spending policy.',
    {
      chain: z.string().describe('Lightning chain alias, e.g. "lightning"'),
      invoice: z.string().describe('The bolt11 invoice to pay'),
      maxFee: z.string().optional().describe('Max routing fee in sats')
    },
    (args) => run(() => wallet.payInvoice(args))
  )

  // ── Allowances ─────────────────────────────────────────────────────────────
  server.tool(
    'get_allowance',
    'Read a token spending allowance (ERC-20 allowance / opt-in / trustline).',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      spender: z.string().describe('Spender address'),
      asset: z.string().describe('Token symbol or contract address')
    },
    ({ chain, spender, asset }) =>
      run(() => wallet.getAllowance(chain, spender, asset))
  )

  server.tool(
    'set_allowance',
    'Approve a spender to move a token amount on your behalf.',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      spender: z.string().describe('Spender address'),
      asset: z.string().describe('Token symbol or contract address'),
      amount: z.string().describe('Decimal amount to approve')
    },
    (args) => run(() => wallet.setAllowance(args))
  )

  // ── Discovery (Prism Index) ─────────────────────────────────────────────────
  server.tool(
    'discover_services',
    'Search the Prism Index for verified, live, agent-payable services (APIs, MCP servers, models, data, and more).',
    {
      q: z.string().optional().describe('Keyword / semantic query'),
      type: z.string().optional().describe('Service type filter'),
      category: z.string().optional().describe('Category slug filter'),
      chains: z
        .array(z.string())
        .optional()
        .describe('Filter to chains you can pay on'),
      asset: z
        .string()
        .optional()
        .describe('Required payment asset, e.g. "USDC"'),
      maxPriceUsd: z.number().optional().describe('Price ceiling in USD'),
      minUptime: z
        .number()
        .optional()
        .describe('Minimum 30d uptime fraction (0-1)'),
      limit: z.number().optional().describe('Max results')
    },
    (args) => run(() => wallet.discoverServices(args))
  )

  server.tool(
    'get_service',
    'Get full details for one Prism Index listing by slug.',
    { slug: z.string().describe('Listing slug') },
    ({ slug }) => run(() => wallet.index.getService(slug))
  )

  // ── Policy & autonomy ──────────────────────────────────────────────────────
  server.tool('get_policy', 'Show the current spending policy.', {}, () =>
    run(() => wallet.getPolicy())
  )

  server.tool(
    'set_policy',
    'Update the spending policy (autonomy mode, per-call/per-day caps, allow/deny lists).',
    {
      autonomy: z
        .enum(['full_autonomous', 'session', 'human_in_the_loop'])
        .optional(),
      maxPerCallUsd: z.string().optional(),
      maxPerDayUsd: z.string().optional(),
      requireConfirmAboveUsd: z.string().optional(),
      allowRecipients: z.array(z.string()).optional(),
      denyRecipients: z.array(z.string()).optional(),
      allowDomains: z.array(z.string()).optional(),
      denyDomains: z.array(z.string()).optional()
    },
    (patch) => run(() => wallet.setPolicy(patch))
  )

  server.tool(
    'get_spending_report',
    'Show spending so far today, remaining budget, recent transfers and receipts.',
    {},
    () => run(() => wallet.getSpendingReport())
  )

  server.tool(
    'confirm_action',
    'Approve a pending action that required human confirmation, using its token.',
    {
      token: z
        .string()
        .describe('Confirmation token from a prior needs_confirmation result')
    },
    ({ token }) => run(() => wallet.confirmAction(token))
  )

  // ── Simulate / sign / status ────────────────────────────────────────────────
  server.tool(
    'simulate',
    'Dry-run a transfer: estimate fees and surface warnings without sending.',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      to: z.string().describe('Recipient address or name'),
      amount: z.string().describe('Decimal amount'),
      asset: z
        .string()
        .optional()
        .describe('Asset symbol/address; defaults to native')
    },
    (args) => run(() => wallet.simulate(args))
  )

  server.tool(
    'sign_message',
    'Sign an arbitrary message with the wallet key for a chain.',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      message: z.string().describe('Message to sign')
    },
    ({ chain, message }) => run(() => wallet.signMessage(chain, message))
  )

  server.tool(
    'get_tx_status',
    'Check the status of a transaction and get an explorer link.',
    {
      chain: z.string().describe('Chain alias or CAIP-2 id'),
      hash: z.string().describe('Transaction hash / id')
    },
    ({ chain, hash }) => run(() => wallet.getTxStatus(chain, hash))
  )
}
