import { describe, it, expect, beforeEach } from 'vitest';
import { MockMemoryStore } from './mocks.js';
import {
  handleStore,
  handleStoreBatch,
  handleSearch,
  handleRecall,
  handleFindRelated,
  handleListRecent,
  handleUpdate,
  handleDelete,
  handleStats,
} from '../src/tools.js';

// ── Helpers ────────────────────────────────────────────────────────

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('store', () => {
  let store: MockMemoryStore;

  beforeEach(() => {
    store = new MockMemoryStore();
  });

  it('stores a memory and returns it with all fields', async () => {
    const handler = handleStore(store);
    const result = await handler({
      content: 'LanceDB supports hybrid search',
      category: 'learning',
      tags: ['lancedb', 'search'],
    });

    expect(result.isError).toBeUndefined();
    const memory = parseResult(result);
    expect(memory.content).toBe('LanceDB supports hybrid search');
    expect(memory.category).toBe('learning');
    expect(memory.tags).toEqual(['lancedb', 'search']);
    expect(memory.id).toBeDefined();
    expect(memory.createdAt).toBeDefined();
    expect(store.memories).toHaveLength(1);
  });
});

describe('store_batch', () => {
  let store: MockMemoryStore;

  beforeEach(() => {
    store = new MockMemoryStore();
  });

  it('stores multiple memories in one call', async () => {
    const handler = handleStoreBatch(store);
    const result = await handler({
      memories: [
        { content: 'First insight', category: 'learning', tags: ['one'] },
        { content: 'Second insight', category: 'architecture', tags: ['two'] },
        { content: 'Third insight', category: 'bug-fix', tags: ['three'] },
      ],
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.stored).toBe(3);
    expect(data.memories).toHaveLength(3);
    expect(store.memories).toHaveLength(3);
  });

  it('handles empty batch gracefully', async () => {
    const handler = handleStoreBatch(store);
    const result = await handler({ memories: [] });

    const data = parseResult(result);
    expect(data.stored).toBe(0);
  });
});

describe('search', () => {
  let store: MockMemoryStore;

  beforeEach(async () => {
    store = new MockMemoryStore();
    await store.store({ content: 'Electron uses Chromium for rendering', category: 'learning', tags: ['electron'] });
    await store.store({ content: 'SQLite is great for structured data', category: 'architecture', tags: ['sqlite'] });
    await store.store({ content: 'LanceDB provides hybrid search', category: 'learning', tags: ['lancedb'] });
  });

  it('finds memories matching the query', async () => {
    const handler = handleSearch(store);
    const result = await handler({ query: 'hybrid search' });

    const data = parseResult(result);
    expect(data.count).toBe(1);
    expect(data.results[0].memory.content).toContain('hybrid search');
  });

  it('filters by category', async () => {
    const handler = handleSearch(store);
    const result = await handler({ query: 'great', category: 'architecture' });

    const data = parseResult(result);
    expect(data.count).toBe(1);
    expect(data.results[0].memory.category).toBe('architecture');
  });

  it('filters by tags', async () => {
    const handler = handleSearch(store);
    const result = await handler({ query: 'electron', tags: ['electron'] });

    const data = parseResult(result);
    expect(data.count).toBe(1);
    expect(data.results[0].memory.tags).toContain('electron');
  });

  it('returns empty results for no match', async () => {
    const handler = handleSearch(store);
    const result = await handler({ query: 'quantum entanglement' });

    const data = parseResult(result);
    expect(data.count).toBe(0);
  });
});

describe('recall', () => {
  let store: MockMemoryStore;

  beforeEach(async () => {
    store = new MockMemoryStore();
    await store.store({ content: 'Electron app architecture', category: 'architecture', tags: ['electron'] });
    await store.store({ content: 'LanceDB memory store', category: 'architecture', tags: ['lancedb'] });
    await store.store({ content: 'Telegram bot API is simple', category: 'learning', tags: ['telegram'] });
  });

  it('searches multiple topics and includes recent', async () => {
    const handler = handleRecall(store);
    const result = await handler({
      topics: ['electron', 'telegram'],
      include_recent: 2,
    });

    const data = parseResult(result);
    expect(data.byTopic['electron']).toBeDefined();
    expect(data.byTopic['telegram']).toBeDefined();
    expect(data.byTopic['electron'].length).toBeGreaterThan(0);
    expect(data.byTopic['telegram'].length).toBeGreaterThan(0);
    expect(data.recent).toBeDefined();
    expect(data.recent.length).toBeLessThanOrEqual(2);
  });
});

describe('find_related', () => {
  let store: MockMemoryStore;

  beforeEach(async () => {
    store = new MockMemoryStore();
    await store.store({ content: 'Memory A', category: 'learning', tags: [] });
    await store.store({ content: 'Memory B', category: 'learning', tags: [] });
    await store.store({ content: 'Memory C', category: 'learning', tags: [] });
  });

  it('returns related memories excluding the original', async () => {
    const targetId = store.memories[0].id;
    const handler = handleFindRelated(store);
    const result = await handler({ memory_id: targetId, limit: 5 });

    const data = parseResult(result);
    expect(data.results.every((r: { memory: { id: string } }) => r.memory.id !== targetId)).toBe(true);
    expect(data.count).toBe(2);
  });

  it('errors on unknown memory ID', async () => {
    const handler = handleFindRelated(store);
    const result = await handler({ memory_id: 'nonexistent', limit: 5 });

    expect(result.isError).toBe(true);
  });
});

describe('list_recent', () => {
  let store: MockMemoryStore;

  beforeEach(async () => {
    store = new MockMemoryStore();
    await store.store({ content: 'Old memory', category: 'learning', tags: [] });
    // Small delay to ensure different timestamps.
    await new Promise(r => setTimeout(r, 10));
    await store.store({ content: 'New memory', category: 'architecture', tags: [] });
  });

  it('returns memories in reverse chronological order', async () => {
    const handler = handleListRecent(store);
    const result = await handler({ limit: 10 });

    const data = parseResult(result);
    expect(data.memories[0].content).toBe('New memory');
    expect(data.memories[1].content).toBe('Old memory');
  });

  it('filters by category', async () => {
    const handler = handleListRecent(store);
    const result = await handler({ limit: 10, category: 'architecture' });

    const data = parseResult(result);
    expect(data.count).toBe(1);
    expect(data.memories[0].category).toBe('architecture');
  });
});

describe('update', () => {
  let store: MockMemoryStore;

  beforeEach(async () => {
    store = new MockMemoryStore();
    await store.store({ content: 'Original content', category: 'learning', tags: ['v1'] });
  });

  it('updates content and tags', async () => {
    const id = store.memories[0].id;
    const handler = handleUpdate(store);
    const result = await handler({
      id,
      content: 'Updated content',
      tags: ['v2'],
    });

    expect(result.isError).toBeUndefined();
    const memory = parseResult(result);
    expect(memory.content).toBe('Updated content');
    expect(memory.tags).toEqual(['v2']);
    expect(memory.category).toBe('learning'); // unchanged
  });

  it('errors on unknown ID', async () => {
    const handler = handleUpdate(store);
    const result = await handler({ id: 'nonexistent', content: 'test' });

    expect(result.isError).toBe(true);
  });
});

describe('delete', () => {
  let store: MockMemoryStore;

  beforeEach(async () => {
    store = new MockMemoryStore();
    await store.store({ content: 'Doomed memory', category: 'other', tags: [] });
  });

  it('removes the memory', async () => {
    const id = store.memories[0].id;
    const handler = handleDelete(store);
    const result = await handler({ id });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.deleted).toBe(true);
    expect(store.memories).toHaveLength(0);
  });

  it('errors on unknown ID', async () => {
    const handler = handleDelete(store);
    const result = await handler({ id: 'nonexistent' });

    expect(result.isError).toBe(true);
  });
});

describe('stats', () => {
  let store: MockMemoryStore;

  beforeEach(async () => {
    store = new MockMemoryStore();
    await store.store({ content: 'A', category: 'learning', tags: [] });
    await store.store({ content: 'B', category: 'learning', tags: [] });
    await store.store({ content: 'C', category: 'architecture', tags: [] });
  });

  it('returns correct counts and category breakdown', async () => {
    const handler = handleStats(store);
    const result = await handler();

    const data = parseResult(result);
    expect(data.totalMemories).toBe(3);
    expect(data.byCategory.learning).toBe(2);
    expect(data.byCategory.architecture).toBe(1);
    expect(data.oldestMemory).toBeDefined();
    expect(data.newestMemory).toBeDefined();
  });

  it('handles empty store', async () => {
    const emptyStore = new MockMemoryStore();
    const handler = handleStats(emptyStore);
    const result = await handler();

    const data = parseResult(result);
    expect(data.totalMemories).toBe(0);
    expect(data.oldestMemory).toBeNull();
  });
});
