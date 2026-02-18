import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TransformersEmbedder } from './embedder.js';
import { HardcopyMemoryStore } from './hardcopy-store.js';
import { LanceMemoryStore } from './memory-store.js';
import { createServer } from './server.js';
import type { MemoryStore } from './types.js';

async function main(): Promise<void> {
  const dbPath = process.env.MEMORY_DB_PATH;
  if (!dbPath) {
    console.error('MEMORY_DB_PATH environment variable is required');
    process.exit(1);
  }

  const modelName = process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2';

  // ── Compose dependencies ──
  const embedder = new TransformersEmbedder(modelName);
  let store: MemoryStore = new LanceMemoryStore(dbPath, embedder);

  if (process.env.ENABLE_HARDCOPY === 'true' && process.env.HARDCOPY_PATH) {
    store = new HardcopyMemoryStore(store, process.env.HARDCOPY_PATH);
    console.error(`[hardcopy] Mirroring mutations to ${process.env.HARDCOPY_PATH}`);
  }

  const server = createServer(store);

  // ── Initialise (download model on first run, connect to DB) ──
  await embedder.initialize();
  await store.initialize();

  // ── Start MCP transport ──
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
