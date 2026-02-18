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
} from '../src/types.js';

// ── MockEmbedder ───────────────────────────────────────────────────
// Returns deterministic pseudo-vectors for testing. No model, no I/O.

export class MockEmbedder implements Embedder {
  readonly callLog: string[] = [];

  async initialize(): Promise<void> {}

  async embed(text: string): Promise<number[]> {
    this.callLog.push(text);
    return this.deterministicVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  dimensions(): number {
    return 384;
  }

  private deterministicVector(text: string): number[] {
    // Simple hash-based pseudo-vector for deterministic testing.
    const vector = new Array<number>(384).fill(0);
    for (let i = 0; i < text.length; i++) {
      vector[i % 384] += text.charCodeAt(i) / 1000;
    }
    // Normalise to unit length.
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
  }
}

// ── MockMemoryStore ────────────────────────────────────────────────
// In-memory store with substring matching for search. Validates that
// tool handlers interact correctly with the MemoryStore interface
// without requiring LanceDB.

export class MockMemoryStore implements MemoryStore {
  memories: Memory[] = [];

  async initialize(): Promise<void> {}

  async store(request: StoreRequest): Promise<Memory> {
    const memory = this.buildMemory(request);
    this.memories.push(memory);
    return memory;
  }

  async storeBatch(requests: StoreRequest[]): Promise<Memory[]> {
    return Promise.all(requests.map(r => this.store(r)));
  }

  async search(
    query: string,
    _mode: SearchMode,
    filters: SearchFilters,
  ): Promise<SearchResult[]> {
    let results = this.memories.filter(m =>
      m.content.toLowerCase().includes(query.toLowerCase()),
    );
    results = this.applyFilters(results, filters);
    const limit = filters.limit ?? 10;
    return results.slice(0, limit).map(m => ({ memory: m, score: 0.9 }));
  }

  async findRelated(memoryId: string, limit: number): Promise<SearchResult[]> {
    const target = this.memories.find(m => m.id === memoryId);
    if (!target) throw new Error(`Memory ${memoryId} not found`);
    return this.memories
      .filter(m => m.id !== memoryId)
      .slice(0, limit)
      .map(m => ({ memory: m, score: 0.5 }));
  }

  async listRecent(limit: number, category?: MemoryCategory): Promise<Memory[]> {
    let results = [...this.memories];
    if (category) {
      results = results.filter(m => m.category === category);
    }
    return results
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async update(id: string, updates: UpdateRequest): Promise<Memory> {
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) throw new Error(`Memory ${id} not found`);

    const existing = this.memories[index];
    const updated: Memory = {
      ...existing,
      content: updates.content ?? existing.content,
      category: updates.category ?? existing.category,
      tags: updates.tags ?? existing.tags,
      updatedAt: new Date().toISOString(),
    };
    this.memories[index] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) throw new Error(`Memory ${id} not found`);
    this.memories.splice(index, 1);
  }

  async stats(): Promise<MemoryStats> {
    const byCategory: Record<string, number> = {};
    for (const m of this.memories) {
      byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
    }
    const sorted = [...this.memories].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return {
      totalMemories: this.memories.length,
      byCategory,
      oldestMemory: sorted[0]?.createdAt ?? null,
      newestMemory: sorted.at(-1)?.createdAt ?? null,
    };
  }

  // ── Helpers ──

  private buildMemory(request: StoreRequest): Memory {
    return {
      id: crypto.randomUUID(),
      content: request.content,
      category: request.category,
      tags: [...request.tags],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private applyFilters(memories: Memory[], filters: SearchFilters): Memory[] {
    let results = memories;
    if (filters.category) {
      results = results.filter(m => m.category === filters.category);
    }
    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(m =>
        filters.tags!.some(t => m.tags.includes(t)),
      );
    }
    if (filters.after) {
      results = results.filter(m => m.createdAt >= filters.after!);
    }
    if (filters.before) {
      results = results.filter(m => m.createdAt <= filters.before!);
    }
    return results;
  }
}
