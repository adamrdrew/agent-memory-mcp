import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryStore } from './types.js';
import { registerTools } from './tools.js';

export function createServer(store: MemoryStore): McpServer {
  const server = new McpServer({
    name: 'agent-memory',
    version: '1.0.0',
  });

  registerTools(server, store);

  return server;
}
