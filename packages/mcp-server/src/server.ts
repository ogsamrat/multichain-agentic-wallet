import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Wallet } from '@prism/wallet'
import { registerAllTools } from './tools/register.js'

/** Build the Prism MCP server with the full wallet tool surface. */
export function createMcpServer(wallet: Wallet): McpServer {
  const server = new McpServer({ name: 'prism', version: '0.1.0' })
  registerAllTools(server, wallet)
  return server
}
