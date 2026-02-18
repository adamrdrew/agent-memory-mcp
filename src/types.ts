// ── Category taxonomy ──────────────────────────────────────────────

export const MEMORY_CATEGORIES = [
  'code-solution',
  'bug-fix',
  'architecture',
  'learning',
  'tool-usage',
  'debugging',
  'performance',
  'security',
  'observation',
  'personal',
  'relationship',
  'other',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

// ── Domain objects ─────────────────────────────────────────────────

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface MemoryStats {
  totalMemories: number;
  byCategory: Record<string, number>;
  oldestMemory: string | null;
  newestMemory: string | null;
}

// ── Request shapes ─────────────────────────────────────────────────

export interface StoreRequest {
  content: string;
  category: MemoryCategory;
  tags: string[];
}

export interface UpdateRequest {
  content?: string;
  category?: MemoryCategory;
  tags?: string[];
}

export interface SearchFilters {
  category?: MemoryCategory;
  tags?: string[];
  after?: string;
  before?: string;
  limit?: number;
}

export type SearchMode = 'hybrid' | 'keyword' | 'semantic';

// ── Dependency interfaces ──────────────────────────────────────────

export interface Embedder {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions(): number;
}

export interface MemoryStore {
  initialize(): Promise<void>;
  store(request: StoreRequest): Promise<Memory>;
  storeBatch(requests: StoreRequest[]): Promise<Memory[]>;
  search(query: string, mode: SearchMode, filters: SearchFilters): Promise<SearchResult[]>;
  findRelated(memoryId: string, limit: number): Promise<SearchResult[]>;
  listRecent(limit: number, category?: MemoryCategory): Promise<Memory[]>;
  update(id: string, updates: UpdateRequest): Promise<Memory>;
  delete(id: string): Promise<void>;
  stats(): Promise<MemoryStats>;
}
