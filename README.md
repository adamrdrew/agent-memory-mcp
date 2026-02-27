# agent-memory-mcp

MCP server for persistent agent memory, backed by [LanceDB](https://lancedb.com/) with hybrid BM25 + vector search. Gives AI agents the ability to store, search, and manage memories across sessions using the [Model Context Protocol](https://modelcontextprotocol.io/).

All data stays on your machine. Embeddings are generated locally using [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via ONNX — no API keys, no network dependencies after initial setup.

## Features

- **Hybrid search** — combines BM25 full-text search with cosine vector similarity via Reciprocal Rank Fusion (RRF)
- **Local embeddings** — runs Xenova/all-MiniLM-L6-v2 locally via ONNX, no external API calls
- **12 memory categories** — structured taxonomy for organising memories
- **Batch operations** — store multiple memories in a single call
- **Hardcopy backup** — optional JSON file mirror of all mutations for human-readable backup
- **Temporal decay** — exponential time-based decay favors recent memories when relevance is similar. Configurable half-life, with `evergreen` and `never-forget` tag exemptions
- **Fully local** — all data stays on disk, no network dependencies after first model download

## Installation

Install the package globally first. This downloads the embedding model (~80 MB) so it's ready when the server starts:

```bash
npm install -g @adamrdrew/agent-memory-mcp
```

Then add the server to your MCP client configuration.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "agent-memory-mcp",
      "env": {
        "MEMORY_DB_PATH": "/path/to/your/memory-db"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "agent-memory": {
    "command": "agent-memory-mcp",
    "env": {
      "MEMORY_DB_PATH": "/path/to/your/memory-db"
    }
  }
}
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `MEMORY_DB_PATH` | Yes | Path to the LanceDB database directory |
| `EMBEDDING_MODEL` | No | HuggingFace model ID (default: `Xenova/all-MiniLM-L6-v2`) |
| `MEMORY_DECAY_HALF_LIFE` | No | Decay half-life in days (default: `30`). Set to `0` to disable temporal decay |
| `ENABLE_HARDCOPY` | No | Set to `true` to enable JSON file backup |
| `HARDCOPY_PATH` | If hardcopy enabled | Directory for JSON mirror files |

## Tools

| Tool | Description |
|---|---|
| `store` | Store a single memory with content, category, and tags |
| `store_batch` | Store multiple memories in one call |
| `search` | Search memories by meaning and/or keywords. Supports hybrid, keyword, and semantic modes |
| `recall` | Multi-topic contextual recall — searches multiple topics in parallel and includes recent memories |
| `find_related` | Find memories similar to a specific memory |
| `list_recent` | List most recent memories, optionally filtered by category |
| `update` | Update an existing memory — re-embeds automatically if content changes |
| `delete` | Permanently remove a memory by ID |
| `stats` | Get database statistics: total count, breakdown by category, timestamps |

## Search Modes

The `search` tool supports three modes:

- **`hybrid`** (default) — combines BM25 keyword scoring with vector similarity using RRF reranking. Falls back to semantic-only if the full-text index is unavailable.
- **`keyword`** — BM25 full-text search only.
- **`semantic`** — cosine vector similarity only.

All modes support filtering by category, tags, and date range.

## Temporal Decay

Search results are scored with exponential time-based decay so that recent memories surface above older ones when semantic relevance is similar. The decay follows a half-life model: a memory one half-life old has its score halved, two half-lives old gets quartered, and so on.

- **Default half-life**: 30 days (configurable via `MEMORY_DECAY_HALF_LIFE`)
- **Disable**: set `MEMORY_DECAY_HALF_LIFE=0`
- **Exempt tags**: memories tagged `evergreen` or `never-forget` are never decayed

## Memory Categories

`code-solution` · `bug-fix` · `architecture` · `learning` · `tool-usage` · `debugging` · `performance` · `security` · `observation` · `personal` · `relationship` · `other`

## Development

```bash
git clone https://github.com/adamrdrew/agent-memory-mcp.git
cd agent-memory-mcp
npm install
npm run dev          # Run with tsx (no build step)
npm run build        # Compile TypeScript to dist/
npm test             # Run all tests
npm run test:watch   # Run tests in watch mode
```

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
