# agent-memory-mcp

MCP server for persistent agent memory, backed by [LanceDB](https://lancedb.com/) with hybrid BM25 + vector search. Gives AI agents the ability to store, search, and manage memories across sessions using the [Model Context Protocol](https://modelcontextprotocol.io/).

## Features

- **Hybrid search** — combines BM25 full-text search with cosine vector similarity via Reciprocal Rank Fusion (RRF)
- **Local embeddings** — runs Xenova/all-MiniLM-L6-v2 locally, no external API calls
- **12 memory categories** — structured taxonomy for organising memories
- **Batch operations** — store multiple memories in a single call
- **Hardcopy backup** — optional JSON file mirror of all mutations for human-readable backup
- **Fully local** — all data stays on disk, no network dependencies after first model download

## Installation

```bash
npm install
npm run build
```

The embedding model (~80 MB) is downloaded automatically on first run.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `MEMORY_DB_PATH` | Yes | Path to the LanceDB database directory |
| `EMBEDDING_MODEL` | No | HuggingFace model ID (default: `Xenova/all-MiniLM-L6-v2`) |
| `ENABLE_HARDCOPY` | No | Set to `true` to enable JSON file backup |
| `HARDCOPY_PATH` | If hardcopy enabled | Directory for JSON mirror files |

## MCP Client Setup

Add to your MCP client configuration (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/path/to/agent-memory-mcp/dist/index.js"],
      "env": {
        "MEMORY_DB_PATH": "/path/to/memory-db"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `store` | Store a single memory with content, category, and tags. Returns the stored memory with its ID. |
| `store_batch` | Store multiple memories in one call. Use at end-of-session to capture everything learnt. |
| `search` | Search memories by meaning and/or keywords. Default mode is hybrid (BM25 + vector). Returns ranked results with relevance scores. |
| `recall` | Multi-topic contextual recall — the "morning coffee" tool. Searches multiple topics in parallel and includes recent memories. Use at session start to restore context. |
| `find_related` | Find memories similar to a specific memory. Use for associative exploration — "what else connects to this?" |
| `list_recent` | List most recent memories, optionally filtered by category. |
| `update` | Update an existing memory — change its content, category, or tags. Re-embeds automatically if content changes. |
| `delete` | Permanently remove a memory by ID. |
| `stats` | Get database statistics: total count, breakdown by category, oldest and newest timestamps. |

## Search Modes

The `search` tool supports three modes:

- **`hybrid`** (default) — combines BM25 keyword scoring with vector similarity using RRF reranking. Falls back to semantic-only if the full-text index is unavailable.
- **`keyword`** — BM25 full-text search only.
- **`semantic`** — cosine vector similarity only.

All modes support filtering by category, tags, and date range.

## Memory Categories

`code-solution` · `bug-fix` · `architecture` · `learning` · `tool-usage` · `debugging` · `performance` · `security` · `observation` · `personal` · `relationship` · `other`

## Development

```bash
npm run dev          # Run with tsx (no build step)
npm run build        # Compile TypeScript to dist/
npm test             # Run all tests
npm run test:watch   # Run tests in watch mode
```

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
