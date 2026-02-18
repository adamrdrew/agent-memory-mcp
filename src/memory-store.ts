import * as lancedb from '@lancedb/lancedb';
import type {
  Embedder,
  Memory,
  MemoryCategory,
  MemoryStore,
  MemoryStats,
  SearchFilters,
  SearchMode,
  SearchResult,
  StoreRequest,
  UpdateRequest,
} from './types.js';

// ── LanceDB row type ───────────────────────────────────────────────
// Uses Record so it's assignable to LanceDB's Data parameter.

type MemoryRow = Record<string, unknown> & {
  id: string;
  content: string;
  category: string;
  tags: string;
  created_at: string;
  updated_at: string;
  vector: number[];
};

// ── LanceMemoryStore ───────────────────────────────────────────────

export class LanceMemoryStore implements MemoryStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private ftsIndexCreated = false;

  constructor(
    private readonly dbPath: string,
    private readonly embedder: Embedder,
  ) {}

  async initialize(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    const names = await this.db.tableNames();
    if (names.includes('memories')) {
      this.table = await this.db.openTable('memories');
      this.ftsIndexCreated = true;
    }
  }

  // ── Storage ────────────────────────────────────────────────────

  async store(request: StoreRequest): Promise<Memory> {
    const row = await this.buildRow(request);
    const seeded = await this.ensureTable(row);
    if (!seeded) {
      await this.table!.add([row]);
    }
    return rowToMemory(row);
  }

  async storeBatch(requests: StoreRequest[]): Promise<Memory[]> {
    if (requests.length === 0) return [];

    const vectors = await this.embedder.embedBatch(requests.map(r => r.content));
    const now = new Date().toISOString();
    const rows = requests.map((req, i) => toRow(req, vectors[i], now));

    const seeded = await this.ensureTable(rows[0]);
    // If the table was just created, rows[0] was already inserted as
    // seed data (LanceDB requires initial data to infer schema).
    const remaining = seeded ? rows.slice(1) : rows;
    if (remaining.length > 0) {
      await this.table!.add(remaining);
    }
    return rows.map(rowToMemory);
  }

  // ── Search ─────────────────────────────────────────────────────

  async search(
    query: string,
    mode: SearchMode = 'hybrid',
    filters: SearchFilters = {},
  ): Promise<SearchResult[]> {
    if (!this.table) return [];

    const limit = filters.limit ?? 10;

    switch (mode) {
      case 'semantic':
        return this.semanticSearch(query, filters, limit);
      case 'keyword':
        return this.keywordSearch(query, filters, limit);
      case 'hybrid':
        return this.hybridSearch(query, filters, limit);
    }
  }

  async findRelated(memoryId: string, limit: number = 5): Promise<SearchResult[]> {
    if (!this.table) return [];

    const original = await this.fetchById(memoryId);
    if (!original) throw new Error(`Memory ${memoryId} not found`);

    const results = await this.table
      .search(original.vector as number[])
      .limit(limit + 1)
      .toArray();

    return results
      .filter((r: Record<string, unknown>) => r.id !== memoryId)
      .slice(0, limit)
      .map(resultToSearchResult);
  }

  async listRecent(limit: number = 10, category?: MemoryCategory): Promise<Memory[]> {
    if (!this.table) return [];

    let q = this.table.query();
    if (category) {
      q = q.where(`category = '${sanitise(category)}'`);
    }
    const rows = await q.toArray();

    return (rows as Record<string, unknown>[])
      .map(rowToMemory)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // ── Mutation ────────────────────────────────────────────────────

  async update(id: string, updates: UpdateRequest): Promise<Memory> {
    if (!this.table) throw new Error('No memories stored yet');

    const existing = await this.fetchById(id);
    if (!existing) throw new Error(`Memory ${id} not found`);

    const content = updates.content ?? (existing.content as string);
    const category = updates.category ?? (existing.category as string);
    const tags = updates.tags ?? JSON.parse(existing.tags as string);
    const now = new Date().toISOString();

    const vector = updates.content
      ? await this.embedder.embed(content)
      : existing.vector as number[];

    const updatedRow: MemoryRow = {
      id,
      content,
      category,
      tags: JSON.stringify(tags),
      created_at: existing.created_at as string,
      updated_at: now,
      vector,
    };

    await this.table.delete(`id = '${sanitise(id)}'`);
    await this.table.add([updatedRow]);

    return rowToMemory(updatedRow);
  }

  async delete(id: string): Promise<void> {
    if (!this.table) throw new Error('No memories stored yet');
    await this.table.delete(`id = '${sanitise(id)}'`);
  }

  // ── Stats ──────────────────────────────────────────────────────

  async stats(): Promise<MemoryStats> {
    if (!this.table) {
      return { totalMemories: 0, byCategory: {}, oldestMemory: null, newestMemory: null };
    }

    const rows = (await this.table.query().toArray()) as Record<string, unknown>[];
    const memories = rows.map(rowToMemory);

    const byCategory: Record<string, number> = {};
    for (const m of memories) {
      byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
    }

    const sorted = [...memories].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      totalMemories: memories.length,
      byCategory,
      oldestMemory: sorted[0]?.createdAt ?? null,
      newestMemory: sorted.at(-1)?.createdAt ?? null,
    };
  }

  // ── Private: search strategies ─────────────────────────────────

  private async semanticSearch(
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<SearchResult[]> {
    const vector = await this.embedder.embed(query);
    const overFetch = limit * 3;
    let search = this.table!.search(vector).limit(overFetch);
    search = applyWhereClause(search, filters);
    const rows = await search.toArray();
    return postFilter(rows, filters).slice(0, limit).map(resultToSearchResult);
  }

  private async keywordSearch(
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<SearchResult[]> {
    try {
      const overFetch = limit * 3;
      let search = this.table!.search(query, 'fts').limit(overFetch);
      search = applyWhereClause(search, filters);
      const rows = await search.toArray();
      return postFilter(rows, filters).slice(0, limit).map(resultToSearchResult);
    } catch {
      // FTS index may not exist yet; keyword search degrades gracefully.
      return [];
    }
  }

  private async hybridSearch(
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<SearchResult[]> {
    const [semantic, keyword] = await Promise.all([
      this.semanticSearch(query, filters, limit * 2),
      this.keywordSearch(query, filters, limit * 2),
    ]);
    return reciprocalRankFusion(semantic, keyword, limit);
  }

  // ── Private: table management ──────────────────────────────────

  /**
   * Ensures the LanceDB table exists. If the table does not exist, it is
   * created with `seedRow` as initial data (LanceDB requires at least one
   * row to infer the schema). Returns `true` if the table was just created
   * and the seed row was inserted, `false` if the table already existed.
   * Callers MUST check the return value to avoid double-inserting the seed.
   */
  private async ensureTable(seedRow: MemoryRow): Promise<boolean> {
    if (this.table) return false;

    this.table = await this.db!.createTable('memories', [seedRow]);
    await this.tryCreateFtsIndex();
    return true;
  }

  private async tryCreateFtsIndex(): Promise<void> {
    if (this.ftsIndexCreated || !this.table) return;
    try {
      await this.table.createIndex('content', { config: lancedb.Index.fts() });
      this.ftsIndexCreated = true;
    } catch {
      // Index creation may fail on very small tables; keyword search degrades gracefully.
    }
  }

  private async fetchById(id: string): Promise<Record<string, unknown> | null> {
    if (!this.table) return null;
    const rows = await this.table.query().where(`id = '${sanitise(id)}'`).limit(1).toArray();
    return (rows[0] as Record<string, unknown>) ?? null;
  }

  private async buildRow(request: StoreRequest): Promise<MemoryRow> {
    const vector = await this.embedder.embed(request.content);
    const now = new Date().toISOString();
    return toRow(request, vector, now);
  }
}

// ── Pure functions ─────────────────────────────────────────────────

function toRow(request: StoreRequest, vector: number[], timestamp: string): MemoryRow {
  return {
    id: crypto.randomUUID(),
    content: request.content,
    category: request.category,
    tags: JSON.stringify(request.tags),
    created_at: timestamp,
    updated_at: timestamp,
    vector,
  };
}

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    content: row.content as string,
    category: row.category as MemoryCategory,
    tags: JSON.parse(row.tags as string),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function resultToSearchResult(row: Record<string, unknown>): SearchResult {
  // Vector search returns _distance (lower = more similar).
  // FTS search returns _score (higher = more relevant) but NOT _distance.
  // The old code defaulted missing _distance to 0, which gave every FTS
  // result a perfect score of 1.0.
  const distance = row._distance as number | undefined;
  const ftsScore = row._score as number | undefined;

  let score: number;
  if (distance != null) {
    score = 1 / (1 + distance);
  } else if (ftsScore != null) {
    score = ftsScore;
  } else {
    score = 0;
  }

  return { memory: rowToMemory(row), score };
}

function reciprocalRankFusion(
  listA: SearchResult[],
  listB: SearchResult[],
  limit: number,
  k: number = 60,
): SearchResult[] {
  const fused = new Map<string, { result: SearchResult; score: number }>();

  for (const [list, weight] of [[listA, 1.0], [listB, 1.0]] as const) {
    list.forEach((result, rank) => {
      const id = result.memory.id;
      const entry = fused.get(id) ?? { result, score: 0 };
      entry.score += weight / (k + rank + 1);
      fused.set(id, entry);
    });
  }

  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ result, score }) => ({ ...result, score }));
}

function applyWhereClause<T extends { where(predicate: string): T }>(
  search: T,
  filters: SearchFilters,
): T {
  const clauses: string[] = [];

  if (filters.category) {
    clauses.push(`category = '${sanitise(filters.category)}'`);
  }
  if (filters.after) {
    clauses.push(`created_at >= '${sanitise(filters.after)}'`);
  }
  if (filters.before) {
    clauses.push(`created_at <= '${sanitise(filters.before)}'`);
  }

  if (clauses.length > 0) {
    return search.where(clauses.join(' AND '));
  }
  return search;
}

function postFilter(
  rows: Record<string, unknown>[],
  filters: SearchFilters,
): Record<string, unknown>[] {
  if (!filters.tags || filters.tags.length === 0) return rows;

  return rows.filter(row => {
    const tags: string[] = JSON.parse(row.tags as string);
    return filters.tags!.some(t => tags.includes(t));
  });
}

function sanitise(value: string): string {
  return value.replace(/'/g, "''");
}
