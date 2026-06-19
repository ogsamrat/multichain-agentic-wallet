#!/usr/bin/env node
import { createWallet } from '@prism/sdk'
import { errorMessage } from '@prism/core'

const argv = process.argv.slice(2)
const [cmd, ...rest] = argv

function flag(name: string): string | undefined {
  const eq = `--${name}=`
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) return argv[i + 1]
    if (argv[i].startsWith(eq)) return argv[i].slice(eq.length)
  }
  return undefined
}

function positionals(): string[] {
  // Positionals always precede flags, so stop at the first --flag (this avoids
  // mistaking a flag's value for a positional).
  const out: string[] = []
  for (const a of rest) {
    if (a.startsWith('--')) break
    out.push(a)
  }
  return out
}

function out(data: unknown): void {
  console.log(
    JSON.stringify(
      data,
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
      2
    )
  )
}

const HELP = `Prism — multichain agentic wallet

Usage: prism <command> [args] [--flags]

  chains                          List supported chains and configuration
  address <chain>                 Show the wallet address for a chain
  balance <chain>                 Show balances for a chain
  portfolio [chains...]           Show balances across configured chains
  send <chain> <to> <amount> [--asset USDC] [--memo m]
  pay <chain> <recipient> <amount> [--asset USDC] [--resource url]
  fetch <url> [--method GET] [--prefer cheapest] [--max-usd 0.5]
  resolve <chain> <name>          Resolve a name to an address
  discover <query...> [--asset USDC] [--max-usd 0.05]
  report                          Spending report
  receipts [--limit 20]           Recent x402 receipts
  policy [--show]                 Show policy
  policy set [--autonomy m] [--max-per-call x] [--max-per-day x]
  tx <chain> <hash>               Transaction status
  init [--generate] [--mnemonic "..."] --passphrase <p>
  unlock --passphrase <p>

Passphrase may also be supplied via PRISM_PASSPHRASE. Keys via PRISM_* env.`

async function main(): Promise<void> {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP)
    return
  }

  const wallet = createWallet()
  const pos = positionals()
  const passphrase = flag('passphrase') ?? process.env.PRISM_PASSPHRASE ?? ''

  switch (cmd) {
    case 'chains':
      return out(await wallet.listChains())
    case 'address':
      return out({ chain: pos[0], address: await wallet.getAddress(pos[0]) })
    case 'balance':
      return out(await wallet.getBalances(pos[0]))
    case 'portfolio':
      return out(await wallet.getPortfolio(pos.length ? pos : undefined))
    case 'send':
      return out(
        await wallet.send({
          chain: pos[0],
          to: pos[1],
          amount: pos[2],
          asset: flag('asset'),
          memo: flag('memo')
        })
      )
    case 'pay':
      return out(
        await wallet.pay({
          chain: pos[0],
          recipient: pos[1],
          amount: pos[2],
          asset: flag('asset'),
          resource: flag('resource')
        })
      )
    case 'fetch': {
      const maxUsd = flag('max-usd')
      return out(
        await wallet.x402Fetch(pos[0], {
          method: flag('method'),
          prefer: flag('prefer') as 'cheapest' | 'fastest' | undefined,
          maxAmountUsd: maxUsd ? Number(maxUsd) : undefined
        })
      )
    }
    case 'resolve':
      return out(await wallet.resolveName(pos[0], pos[1]))
    case 'discover': {
      const maxUsd = flag('max-usd')
      return out(
        await wallet.discoverServices({
          q: pos.join(' ') || undefined,
          asset: flag('asset'),
          maxPriceUsd: maxUsd ? Number(maxUsd) : undefined
        })
      )
    }
    case 'report':
      return out(wallet.getSpendingReport())
    case 'receipts':
      return out(wallet.listReceipts(Number(flag('limit') ?? '20')))
    case 'policy':
      if (pos[0] === 'set') {
        return out(
          wallet.setPolicy({
            autonomy: flag('autonomy') as never,
            maxPerCallUsd: flag('max-per-call'),
            maxPerDayUsd: flag('max-per-day')
          })
        )
      }
      return out(wallet.getPolicy())
    case 'tx':
      return out(await wallet.getTxStatus(pos[0], pos[1]))
    case 'init':
      return out(
        await wallet.initWallet({
          generate: argv.includes('--generate'),
          mnemonic: flag('mnemonic'),
          passphrase
        })
      )
    case 'unlock':
      return out(wallet.unlock(passphrase))
    default:
      console.error(`Unknown command: ${cmd}\n`)
      console.log(HELP)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', errorMessage(err))
  process.exit(1)
})
