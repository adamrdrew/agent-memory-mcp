import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LanceMemoryStore } from '../src/memory-store.js';
import { MockEmbedder } from './mocks.js';

// ── Integration tests against real LanceDB ────────────────────────
//
// These tests use the actual LanceMemoryStore with a real LanceDB
// database on disk, but with MockEmbedder for deterministic vectors.
// The mock-only unit tests missed bugs in the LanceDB interaction
// layer — these tests exist to catch exactly those bugs.

describe('LanceMemoryStore integration', () => {
  let store: LanceMemoryStore;
  let dbPath: string;
  let embedder: MockEmbedder;

  beforeEach(async () => {
    dbPath = await mkdtemp(join(tmpdir(), 'agent-memory-test-'));
    embedder = new MockEmbedder();
    store = new LanceMemoryStore(dbPath, embedder);
    await store.initialize();
  });

  afterEach(async () => {
    await rm(dbPath, { recursive: true, force: true });
  });

  // ── Row count integrity ───────────────────────────────────────

  describe('store does not create duplicates', () => {
    it('stores exactly one row for the first memory', async () => {
      await store.store({
        content: 'The very first memory stored',
        category: 'learning',
        tags: ['test'],
      });

      const stats = await store.stats();
      expect(stats.totalMemories).toBe(1);
    });

    it('stores exactly N rows for N sequential stores', async () => {
      await store.store({ content: 'First', category: 'learning', tags: [] });
      await store.store({ content: 'Second', category: 'learning', tags: [] });
      await store.store({ content: 'Third', category: 'learning', tags: [] });

      const stats = await store.stats();
      expect(stats.totalMemories).toBe(3);
    });
  });

  describe('storeBatch does not create duplicates', () => {
    it('stores exactly N rows when batch is the first operation', async () => {
      await store.storeBatch([
        { content: 'Alpha', category: 'learning', tags: [] },
        { content: 'Beta', category: 'architecture', tags: [] },
        { content: 'Gamma', category: 'other', tags: [] },
      ]);

      const stats = await store.stats();
      expect(stats.totalMemories).toBe(3);
    });

    it('stores exactly N rows when batch follows a store', async () => {
      await store.store({ content: 'First', category: 'learning', tags: [] });
      await store.storeBatch([
        { content: 'Alpha', category: 'learning', tags: [] },
        { content: 'Beta', category: 'architecture', tags: [] },
      ]);

      const stats = await store.stats();
      expect(stats.totalMemories).toBe(3);
    });
  });

  describe('update preserves row count', () => {
    it('does not increase row count after update', async () => {
      const memory = await store.store({
        content: 'Original content',
        category: 'learning',
        tags: ['v1'],
      });

      await store.update(memory.id, { content: 'Updated content' });

      const stats = await store.stats();
      expect(stats.totalMemories).toBe(1);
    });

    it('does not leave stale rows after multiple updates', async () => {
      const memory = await store.store({
        content: 'Version 1',
        category: 'learning',
        tags: [],
      });

      await store.update(memory.id, { content: 'Version 2' });
      await store.update(memory.id, { content: 'Version 3' });
      await store.update(memory.id, { content: 'Version 4' });

      const stats = await store.stats();
      expect(stats.totalMemories).toBe(1);
    });
  });

  describe('delete removes exactly one row', () => {
    it('reduces count by one', async () => {
      const a = await store.store({ content: 'Keep', category: 'learning', tags: [] });
      const b = await store.store({ content: 'Remove', category: 'learning', tags: [] });

      await store.delete(b.id);

      const stats = await store.stats();
      expect(stats.totalMemories).toBe(1);

      const recent = await store.listRecent(10);
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe(a.id);
    });
  });

  // ── No duplicate IDs in search results ────────────────────────

  describe('search results contain no duplicate IDs', () => {
    it('semantic search returns unique IDs', async () => {
      await store.store({ content: 'Memory about search algorithms', category: 'learning', tags: [] });
      await store.store({ content: 'Memory about sorting algorithms', category: 'learning', tags: [] });
      await store.store({ content: 'Memory about database indexing', category: 'architecture', tags: [] });

      const results = await store.search('algorithms', 'semantic', { limit: 10 });
      const ids = results.map(r => r.memory.id);
      expect(ids.length).toBe(new Set(ids).size);
    });

    it('hybrid search returns unique IDs', async () => {
      await store.store({ content: 'Memory about search algorithms', category: 'learning', tags: [] });
      await store.store({ content: 'Memory about sorting algorithms', category: 'learning', tags: [] });
      await store.store({ content: 'Memory about database indexing', category: 'architecture', tags: [] });

      const results = await store.search('algorithms', 'hybrid', { limit: 10 });
      const ids = results.map(r => r.memory.id);
      expect(ids.length).toBe(new Set(ids).size);
    });
  });

  describe('findRelated returns no duplicate IDs', () => {
    it('returns unique IDs excluding the source', async () => {
      const source = await store.store({
        content: 'Memory about search algorithms and data structures',
        category: 'learning',
        tags: [],
      });
      await store.store({
        content: 'Memory about sorting algorithms and complexity',
        category: 'learning',
        tags: [],
      });
      await store.store({
        content: 'Memory about database indexing strategies',
        category: 'architecture',
        tags: [],
      });

      const results = await store.findRelated(source.id, 5);
      const ids = results.map(r => r.memory.id);

      // No duplicate IDs
      expect(ids.length).toBe(new Set(ids).size);
      // Source memory excluded
      expect(ids).not.toContain(source.id);
    });
  });

  // ── Search correctness ────────────────────────────────────────

  // Note: semantic ranking quality depends on the embedder, not the store.
  // MockEmbedder uses hash-based pseudo-vectors, so we test structure and
  // score validity rather than ranking accuracy.

  describe('semantic search returns valid results', () => {
    it('returns results with scores between 0 and 1', async () => {
      await store.store({
        content: 'Cooking pasta requires boiling water and adding salt',
        category: 'other',
        tags: [],
      });
      await store.store({
        content: 'Vector databases use embeddings for similarity search',
        category: 'architecture',
        tags: [],
      });

      const results = await store.search('embedding similarity', 'semantic', { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
        expect(r.memory.id).toBeDefined();
        expect(r.memory.content).toBeDefined();
      }
    });
  });

  describe('hybrid search returns valid results', () => {
    it('returns results with scores and valid structure', async () => {
      await store.store({
        content: 'Cooking pasta requires boiling water and adding salt',
        category: 'other',
        tags: [],
      });
      await store.store({
        content: 'Vector databases use embeddings for similarity search',
        category: 'architecture',
        tags: [],
      });

      const results = await store.search('vector embeddings', 'hybrid', { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.memory.id).toBeDefined();
        expect(r.memory.content).toBeDefined();
      }
    });
  });

  // ── Recall (compound operation) ───────────────────────────────

  describe('recall', () => {
    it('returns results per topic and recent memories', async () => {
      await store.store({ content: 'Electron uses Chromium', category: 'learning', tags: [] });
      await store.store({ content: 'Stoic philosophy values virtue', category: 'learning', tags: [] });
      await store.store({ content: 'LanceDB hybrid search', category: 'architecture', tags: [] });

      // recall is exercised through the tools layer — test via search + listRecent
      const topic1 = await store.search('Electron', 'hybrid', { limit: 2 });
      const topic2 = await store.search('philosophy', 'hybrid', { limit: 2 });
      const recent = await store.listRecent(2);

      expect(topic1.length).toBeGreaterThan(0);
      expect(topic2.length).toBeGreaterThan(0);
      expect(recent.length).toBeGreaterThan(0);
    });
  });

  // ── Filter correctness ────────────────────────────────────────

  describe('filters work on real data', () => {
    it('category filter restricts results', async () => {
      await store.store({ content: 'A learning memory', category: 'learning', tags: ['a'] });
      await store.store({ content: 'An architecture memory', category: 'architecture', tags: ['b'] });

      const results = await store.search('memory', 'semantic', {
        category: 'learning',
        limit: 10,
      });

      for (const r of results) {
        expect(r.memory.category).toBe('learning');
      }
    });

    it('tag filter restricts results', async () => {
      await store.store({ content: 'Tagged alpha', category: 'learning', tags: ['alpha'] });
      await store.store({ content: 'Tagged beta', category: 'learning', tags: ['beta'] });

      const results = await store.search('tagged', 'semantic', {
        tags: ['alpha'],
        limit: 10,
      });

      for (const r of results) {
        expect(r.memory.tags).toContain('alpha');
      }
    });
  });

  // ── listRecent correctness ────────────────────────────────────

  describe('listRecent with real data', () => {
    it('returns memories in reverse chronological order', async () => {
      await store.store({ content: 'First stored', category: 'learning', tags: [] });
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 50));
      await store.store({ content: 'Second stored', category: 'learning', tags: [] });

      const recent = await store.listRecent(10);
      expect(recent).toHaveLength(2);
      expect(recent[0].content).toBe('Second stored');
      expect(recent[1].content).toBe('First stored');
    });
  });

  // ── Temporal decay integration ──────────────────────────────────

  describe('temporal decay in search results', () => {
    it('scores are between 0 and 1 with decay active', async () => {
      // Memories stored now have decay factor ≈ 1.0, so scores
      // should still be in [0, 1] range.
      await store.store({
        content: 'Fresh memory about vector databases',
        category: 'architecture',
        tags: [],
      });
      await store.store({
        content: 'Fresh memory about embedding similarity',
        category: 'learning',
        tags: [],
      });

      const results = await store.search('vector embedding', 'semantic', { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it('results are sorted by decayed score descending', async () => {
      await store.store({
        content: 'Memory about algorithms and data structures',
        category: 'learning',
        tags: [],
      });
      await store.store({
        content: 'Memory about database algorithms',
        category: 'architecture',
        tags: [],
      });

      const results = await store.search('algorithms', 'semantic', { limit: 10 });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('evergreen memories are not decayed', async () => {
      // Store two memories with identical content but one is evergreen.
      // Since they're stored at the same time, decay won't change relative
      // order — but we verify the evergreen one has score present.
      await store.store({
        content: 'Evergreen fact about algorithms',
        category: 'learning',
        tags: ['evergreen'],
      });
      await store.store({
        content: 'Regular fact about algorithms',
        category: 'learning',
        tags: [],
      });

      const results = await store.search('algorithms', 'semantic', { limit: 10 });
      expect(results.length).toBe(2);

      // Both should have valid scores
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });

    it('never-forget tag also exempts from decay', async () => {
      await store.store({
        content: 'Important memory tagged never-forget',
        category: 'personal',
        tags: ['never-forget'],
      });

      const results = await store.search('important memory', 'semantic', { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.tags).toContain('never-forget');
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  // ── Access tracking ───────────────────────────────────────────

  describe('access tracking', () => {
    it('respects spacing effect — no increment within 1 hour of creation', async () => {
      await store.store({
        content: 'Memory about unique hamiltonian cycles in graph theory',
        category: 'learning',
        tags: ['math'],
      });

      // Search immediately after creation — spacing effect should prevent
      // increment because last_accessed_at = creation time = just now (< 1 hour)
      await store.search('hamiltonian cycles', 'semantic', { limit: 5 });
      await new Promise(r => setTimeout(r, 300));

      // Memory should still be "never accessed" due to spacing effect
      const stats = await store.stats();
      expect(stats.neverAccessed).toBe(1);
      expect(stats.avgAccessCount).toBe(0);
    });

    it('stats mostAccessed has correct structure', async () => {
      await store.store({
        content: 'Popular memory about vector databases and similarity',
        category: 'architecture',
        tags: ['databases'],
      });
      await store.store({
        content: 'Obscure memory about medieval typography',
        category: 'learning',
        tags: ['history'],
      });

      const stats = await store.stats();
      expect(stats.mostAccessed.length).toBe(2);
      for (const entry of stats.mostAccessed) {
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('content');
        expect(entry).toHaveProperty('count');
        expect(typeof entry.count).toBe('number');
      }
    });

    it('new rows include access_count and last_accessed_at columns', async () => {
      const memory = await store.store({
        content: 'Memory to check schema',
        category: 'learning',
        tags: [],
      });

      // Verify through stats that the memory has correct initial state
      const stats = await store.stats();
      expect(stats.neverAccessed).toBe(1);
      expect(stats.mostAccessed).toHaveLength(1);
      expect(stats.mostAccessed[0].count).toBe(0);
      expect(stats.mostAccessed[0].id).toBe(memory.id);
    });
  });

  // ── Pruning ──────────────────────────────────────────────────

  describe('prune', () => {
    it('dry run returns candidates without deleting', async () => {
      await store.store({
        content: 'Fresh memory that should not be pruned',
        category: 'learning',
        tags: [],
      });

      const result = await store.prune({ dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.pruned).toBe(0);
      expect(result.inspected).toBe(1);
      // Fresh memory should not be a prune candidate
      expect(result.candidates).toHaveLength(0);
    });

    it('does not prune evergreen memories', async () => {
      await store.store({
        content: 'Evergreen memory preserved forever',
        category: 'personal',
        tags: ['evergreen'],
      });

      const result = await store.prune({
        dryRun: true,
        minStrength: 1.0, // Everything below 1.0 would be pruned
      });
      // Evergreen should be excluded from candidates
      expect(result.candidates).toHaveLength(0);
    });

    it('returns empty when table has no memories', async () => {
      const result = await store.prune({ dryRun: true });
      expect(result.inspected).toBe(0);
      expect(result.candidates).toHaveLength(0);
    });

    it('prune with dryRun false deletes candidates', async () => {
      // Store a memory, then prune with very aggressive threshold
      await store.store({
        content: 'Memory to be pruned aggressively',
        category: 'other',
        tags: [],
      });

      const statsBefore = await store.stats();
      expect(statsBefore.totalMemories).toBe(1);

      // Prune with minStrength = 1.0 — only a memory updated right now has strength 1.0
      // Our fresh memory has strength ≈ 1.0, so use maxDormantDays = 0 instead
      const result = await store.prune({
        dryRun: false,
        maxDormantDays: 0, // Any never-accessed memory is eligible
        minStrength: 0.0001, // Don't prune based on strength alone
      });

      expect(result.dryRun).toBe(false);
      expect(result.pruned).toBe(1);

      const statsAfter = await store.stats();
      expect(statsAfter.totalMemories).toBe(0);
    });
  });

  // ── Enhanced stats ──────────────────────────────────────────

  describe('enhanced stats', () => {
    it('returns access tracking fields', async () => {
      await store.store({
        content: 'Memory for stats test',
        category: 'learning',
        tags: [],
      });

      const stats = await store.stats();
      expect(stats).toHaveProperty('neverAccessed');
      expect(stats).toHaveProperty('belowPruneThreshold');
      expect(stats).toHaveProperty('avgAccessCount');
      expect(stats).toHaveProperty('mostAccessed');
      expect(stats.neverAccessed).toBe(1);
      expect(stats.avgAccessCount).toBe(0);
      expect(stats.mostAccessed).toHaveLength(1);
    });

    it('empty store returns zero access stats', async () => {
      const stats = await store.stats();
      expect(stats.neverAccessed).toBe(0);
      expect(stats.belowPruneThreshold).toBe(0);
      expect(stats.avgAccessCount).toBe(0);
      expect(stats.mostAccessed).toHaveLength(0);
    });
  });
});
