import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MEMORY_CATEGORIES,
  type MemoryStore,
  type SearchMode,
  type SearchResult,
  type StoreRequest,
} from './types.js';

// ── Zod schemas ────────────────────────────────────────────────────

const categorySchema = z.enum(
  MEMORY_CATEGORIES as unknown as [string, ...string[]],
);

const tagsSchema = z.array(z.string()).describe('Free-form tags for organisation');

const filtersSchema = {
  category: categorySchema.optional().describe('Filter by category'),
  tags: z.array(z.string()).optional().describe('Filter: memory must have at least one of these tags'),
  after: z.string().optional().describe('Filter: created after this ISO 8601 date'),
  before: z.string().optional().describe('Filter: created before this ISO 8601 date'),
  limit: z.number().optional().describe('Max results to return (default 10)'),
};

const modeSchema = z
  .enum(['hybrid', 'keyword', 'semantic'])
  .optional()
  .describe('Search mode: hybrid (default), keyword-only, or semantic-only');

// ── Tool result helpers ────────────────────────────────────────────
// Returns plain objects compatible with the MCP SDK's CallToolResult
// (which requires an index signature [key: string]: unknown).

function success(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function error(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

// ── Handler factories ──────────────────────────────────────────────
// Each factory closes over a MemoryStore, returning a handler function
// that the MCP server can invoke. This keeps tools testable without
// an MCP server instance.

export function handleStore(store: MemoryStore) {
  return async (args: { content: string; category: string; tags: string[] }): Promise<ReturnType<typeof success>> => {
    try {
      const memory = await store.store(args as StoreRequest);
      return success(memory);
    } catch (err) {
      return error(`Failed to store memory: ${String(err)}`);
    }
  };
}

export function handleStoreBatch(store: MemoryStore) {
  return async (args: { memories: Array<{ content: string; category: string; tags: string[] }> }): Promise<ReturnType<typeof success>> => {
    try {
      const memories = await store.storeBatch(args.memories as StoreRequest[]);
      return success({ stored: memories.length, memories });
    } catch (err) {
      return error(`Failed to store batch: ${String(err)}`);
    }
  };
}

export function handleSearch(store: MemoryStore) {
  return async (args: {
    query: string;
    mode?: string;
    category?: string;
    tags?: string[];
    after?: string;
    before?: string;
    limit?: number;
  }): Promise<ReturnType<typeof success>> => {
    try {
      const mode = (args.mode ?? 'hybrid') as SearchMode;
      const results = await store.search(args.query, mode, {
        category: args.category as StoreRequest['category'],
        tags: args.tags,
        after: args.after,
        before: args.before,
        limit: args.limit,
      });
      return success({ count: results.length, results });
    } catch (err) {
      return error(`Search failed: ${String(err)}`);
    }
  };
}

export function handleRecall(store: MemoryStore) {
  return async (args: {
    topics: string[];
    include_recent?: number;
    limit_per_topic?: number;
  }): Promise<ReturnType<typeof success>> => {
    try {
      const limitPerTopic = args.limit_per_topic ?? 5;
      const includeRecent = args.include_recent ?? 5;

      const byTopic: Record<string, SearchResult[]> = {};
      await Promise.all(
        args.topics.map(async (topic) => {
          byTopic[topic] = await store.search(topic, 'hybrid', { limit: limitPerTopic });
        }),
      );

      const recent = await store.listRecent(includeRecent);
      return success({ byTopic, recent });
    } catch (err) {
      return error(`Recall failed: ${String(err)}`);
    }
  };
}

export function handleFindRelated(store: MemoryStore) {
  return async (args: { memory_id: string; limit?: number }): Promise<ReturnType<typeof success>> => {
    try {
      const results = await store.findRelated(args.memory_id, args.limit ?? 5);
      return success({ count: results.length, results });
    } catch (err) {
      return error(`Find related failed: ${String(err)}`);
    }
  };
}

export function handleListRecent(store: MemoryStore) {
  return async (args: { limit?: number; category?: string }): Promise<ReturnType<typeof success>> => {
    try {
      const memories = await store.listRecent(
        args.limit ?? 10,
        args.category as StoreRequest['category'],
      );
      return success({ count: memories.length, memories });
    } catch (err) {
      return error(`List recent failed: ${String(err)}`);
    }
  };
}

export function handleUpdate(store: MemoryStore) {
  return async (args: {
    id: string;
    content?: string;
    category?: string;
    tags?: string[];
  }): Promise<ReturnType<typeof success>> => {
    try {
      const memory = await store.update(args.id, {
        content: args.content,
        category: args.category as StoreRequest['category'],
        tags: args.tags,
      });
      return success(memory);
    } catch (err) {
      return error(`Update failed: ${String(err)}`);
    }
  };
}

export function handleDelete(store: MemoryStore) {
  return async (args: { id: string }): Promise<ReturnType<typeof success>> => {
    try {
      await store.delete(args.id);
      return success({ deleted: true, id: args.id });
    } catch (err) {
      return error(`Delete failed: ${String(err)}`);
    }
  };
}

export function handleStats(store: MemoryStore) {
  return async (): Promise<ReturnType<typeof success>> => {
    try {
      const stats = await store.stats();
      return success(stats);
    } catch (err) {
      return error(`Stats failed: ${String(err)}`);
    }
  };
}

// ── Registration ───────────────────────────────────────────────────

export function registerTools(server: McpServer, store: MemoryStore): void {
  // ── Storage tools ──

  server.tool(
    'store',
    'Store a single memory with content, category, and tags. Returns the stored memory with its ID.',
    {
      content: z.string().describe('The memory content — what you learnt, observed, or want to remember'),
      category: categorySchema.describe('Memory category'),
      tags: tagsSchema,
    },
    handleStore(store),
  );

  server.tool(
    'store_batch',
    'Store multiple memories in one call. Use at end-of-session to capture everything learnt. Returns all stored memories.',
    {
      memories: z.array(z.object({
        content: z.string().describe('The memory content'),
        category: categorySchema,
        tags: tagsSchema,
      })).describe('Array of memories to store'),
    },
    handleStoreBatch(store),
  );

  // ── Search tools ──

  server.tool(
    'search',
    'Search memories by meaning and/or keywords. Default mode is hybrid (BM25 + vector). Returns ranked results with relevance scores.',
    {
      query: z.string().describe('What to search for — a concept, phrase, or question'),
      mode: modeSchema,
      ...filtersSchema,
    },
    handleSearch(store),
  );

  server.tool(
    'recall',
    'Multi-topic contextual recall — the morning coffee tool. Searches multiple topics in parallel and includes recent memories. Use at session start to restore context efficiently.',
    {
      topics: z.array(z.string()).describe('List of topics to search for'),
      include_recent: z.number().optional().describe('Number of recent memories to include (default 5)'),
      limit_per_topic: z.number().optional().describe('Max results per topic (default 5)'),
    },
    handleRecall(store),
  );

  server.tool(
    'find_related',
    'Find memories similar to a specific memory. Use for associative exploration — "what else do I know that connects to this?"',
    {
      memory_id: z.string().describe('ID of the memory to find relatives of'),
      limit: z.number().optional().describe('Max related memories to return (default 5)'),
    },
    handleFindRelated(store),
  );

  server.tool(
    'list_recent',
    'List most recent memories, optionally filtered by category. Use to see what you have been learning lately.',
    {
      limit: z.number().optional().describe('Max memories to return (default 10)'),
      category: categorySchema.optional().describe('Filter by category'),
    },
    handleListRecent(store),
  );

  // ── Management tools ──

  server.tool(
    'update',
    'Update an existing memory — change its content, category, or tags. If content changes, the embedding is regenerated automatically.',
    {
      id: z.string().describe('ID of the memory to update'),
      content: z.string().optional().describe('New content (triggers re-embedding)'),
      category: categorySchema.optional().describe('New category'),
      tags: tagsSchema.optional().describe('New tags (replaces existing)'),
    },
    handleUpdate(store),
  );

  server.tool(
    'delete',
    'Permanently remove a memory by ID.',
    {
      id: z.string().describe('ID of the memory to delete'),
    },
    handleDelete(store),
  );

  server.tool(
    'stats',
    'Get memory database statistics: total count, breakdown by category, oldest and newest timestamps.',
    {},
    handleStats(store),
  );
}
