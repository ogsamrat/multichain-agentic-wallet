#!/usr/bin/env node
import { redirectConsoleToStderr } from '@prism/core'

// MCP speaks JSON-RPC over stdout; payment libraries log freely. Force every
// console write to stderr before anything else can corrupt the transport.
redirectConsoleToStderr()

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createWallet } from '@prism/wallet'
import { createMcpServer } from './server.js'

const wallet = createWallet()
const server = createMcpServer(wallet)
const transport = new StdioServerTransport()
await server.connect(transport)
