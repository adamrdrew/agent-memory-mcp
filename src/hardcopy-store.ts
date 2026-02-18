import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type {
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

// ── HardcopyMemoryStore ─────────────────────────────────────────
//
// Transparent decorator that mirrors all mutations to plain JSON
// files on disk. One file per memory, named {id}.json. Read
// operations delegate straight through — the hardcopy is write-only.
//
// Hardcopy errors are logged to stderr but never propagate.
// The primary store is the source of truth; the hardcopy is
// a human-readable escape hatch.

export class HardcopyMemoryStore implements MemoryStore {
  constructor(
    private readonly inner: MemoryStore,
    private readonly hardcopyPath: string,
  ) {}

  async initialize(): Promise<void> {
    await this.inner.initialize();
    await mkdir(this.hardcopyPath, { recursive: true });
  }

  // ── Mutations (mirrored to disk) ────────────────────────────

  async store(request: StoreRequest): Promise<Memory> {
    const memory = await this.inner.store(request);
    await this.writeHardcopy(memory);
    return memory;
  }

  async storeBatch(requests: StoreRequest[]): Promise<Memory[]> {
    const memories = await this.inner.storeBatch(requests);
    await Promise.all(memories.map(m => this.writeHardcopy(m)));
    return memories;
  }

  async update(id: string, updates: UpdateRequest): Promise<Memory> {
    const memory = await this.inner.update(id, updates);
    await this.writeHardcopy(memory);
    return memory;
  }

  async delete(id: string): Promise<void> {
    await this.inner.delete(id);
    await this.deleteHardcopy(id);
  }

  // ── Reads (pass through) ────────────────────────────────────

  async search(query: string, mode: SearchMode, filters: SearchFilters): Promise<SearchResult[]> {
    return this.inner.search(query, mode, filters);
  }

  async findRelated(memoryId: string, limit: number): Promise<SearchResult[]> {
    return this.inner.findRelated(memoryId, limit);
  }

  async listRecent(limit: number, category?: MemoryCategory): Promise<Memory[]> {
    return this.inner.listRecent(limit, category);
  }

  async stats(): Promise<MemoryStats> {
    return this.inner.stats();
  }

  // ── Private ─────────────────────────────────────────────────

  private async writeHardcopy(memory: Memory): Promise<void> {
    try {
      const filePath = join(this.hardcopyPath, `${memory.id}.json`);
      await writeFile(filePath, JSON.stringify(memory, null, 2) + '\n');
    } catch (err) {
      console.error(`[hardcopy] Failed to write ${memory.id}:`, err);
    }
  }

  private async deleteHardcopy(id: string): Promise<void> {
    try {
      const filePath = join(this.hardcopyPath, `${id}.json`);
      await unlink(filePath);
    } catch (err) {
      // File may not exist (e.g. hardcopy was enabled after the memory
      // was created). That's fine — don't log ENOENT noise.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[hardcopy] Failed to delete ${id}:`, err);
      }
    }
  }
}
