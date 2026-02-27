# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for a memory system backed by LanceDB with hybrid BM25 + vector search. Exposes 8 tools (store, store_batch, search, recall, find_related, list_recent, update, stats) over stdio transport. Uses Xenova/all-MiniLM-L6-v2 embeddings (384 dimensions) via Hugging Face transformers.

## Commands

- **Build**: `npm run build` (runs `tsc`, outputs to `dist/`)
- **Dev**: `npm run dev` (runs `tsx src/index.ts` directly)
- **Start**: `npm start` (runs compiled `dist/index.js`)
- **Test all**: `npm test` (runs `vitest run`)
- **Test watch**: `npm run test:watch`
- **Run single test**: `npx vitest run tests/tools.test.ts`
- **Run single test by name**: `npx vitest run -t "store tool"`

## Environment Variables

- `MEMORY_DB_PATH` (required) — LanceDB database path on disk
- `EMBEDDING_MODEL` (optional) — HuggingFace model ID, defaults to `Xenova/all-MiniLM-L6-v2`
- `MEMORY_DECAY_HALF_LIFE` (optional) — temporal decay half-life in days, defaults to `30`. Set to `0` to disable decay
- `ENABLE_HARDCOPY` — set to `'true'` to enable JSON file backup
- `HARDCOPY_PATH` (required if hardcopy enabled) — directory for JSON mirror files

## Architecture

**Composition chain** (wired in `src/index.ts`):
```
Embedder → MemoryStore → [HardcopyMemoryStore] → MCP Server → stdio transport
```

**Key interfaces** (`src/types.ts`): `Embedder`, `MemoryStore`, `SearchFilters`, `Memory`, `SearchResult`. All components code against these interfaces, enabling mock-based unit testing.

**LanceMemoryStore** (`src/memory-store.ts`): The main storage layer. Uses LanceDB with a fixed 7-column schema (id, content, category, tags as JSON string, created_at, updated_at, vector). Search uses over-fetching (3× limit) with post-filtering. Category/date filters are SQL WHERE clauses; tag filtering is done in-memory after search. Updates use delete-then-re-add (LanceDB limitation). Hybrid search combines BM25 FTS + cosine vector via RRF reranking, with graceful fallback to semantic-only if FTS index is unavailable. Search results have exponential temporal decay applied (configurable half-life, default 30 days) so recent memories score higher. Memories tagged `evergreen` or `never-forget` are exempt from decay. Results are re-sorted by decayed score before returning.

**HardcopyMemoryStore** (`src/hardcopy-store.ts`): Decorator pattern — wraps any MemoryStore and mirrors mutations to `{id}.json` files on disk. Write-only (reads delegate to inner store). Errors are logged to stderr but never propagate.

**Tools** (`src/tools.ts`): Registers 8 MCP tools on the server. Each tool handler validates input with Zod schemas, calls the store, and returns JSON-stringified results. The `recall` tool is a composite that runs multiple searches + recent memories.

## Testing

Four test files in `tests/`:
- `tools.test.ts` — unit tests for all tool handlers using mocks from `tests/mocks.ts`
- `integration.test.ts` — tests LanceMemoryStore with real LanceDB on a temp directory (includes temporal decay integration tests)
- `hardcopy.test.ts` — tests the hardcopy decorator file operations
- `temporal-decay.test.ts` — unit tests for decay math (`computeDecayFactor`, `parseDecayHalfLife`, `EVERGREEN_TAGS`)

`MockEmbedder` produces deterministic hash-based pseudo-vectors. `MockMemoryStore` is an in-memory implementation with substring search matching.

## Conventions

- ES modules (`"type": "module"` in package.json), TypeScript strict mode, target ES2022
- 2-space indentation
- camelCase in TypeScript, snake_case for database column names (e.g., `created_at`)
- 12 memory categories defined as a union type in `types.ts`
