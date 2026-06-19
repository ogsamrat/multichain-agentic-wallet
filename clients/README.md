# Prism clients

Tiny, dependency-free example agents — in several languages — that query the
[Prism Index](https://prism-index.vercel.app) to discover verified,
agent-payable services. Each defaults to the hosted Index and accepts a search
term; set `PRISM_INDEX_URL` to point at your own deployment.

| Language   | Run                                                                             |
| ---------- | ------------------------------------------------------------------------------- |
| Python     | `python clients/python/agent.py "rpc"`                                          |
| Go         | `cd clients/go && go run . "insight"`                                           |
| Ruby       | `ruby clients/ruby/agent.rb "datasets"`                                         |
| TypeScript | `import { createWallet } from '@prism/sdk'` then `wallet.discoverServices(...)` |

To actually pay an x402 service you discover, drive the Prism wallet:

```bash
node apps/cli/dist/index.js fetch <callHint.url> --method POST
```

or call `wallet.x402Fetch(url)` from the SDK — it negotiates and settles the
402 across whichever chain your wallet can fund.
