import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { HardcopyMemoryStore } from '../src/hardcopy-store.js';
import { MockMemoryStore } from './mocks.js';
import type { Memory } from '../src/types.js';

describe('HardcopyMemoryStore', () => {
  let inner: MockMemoryStore;
  let store: HardcopyMemoryStore;
  let hardcopyPath: string;

  beforeEach(async () => {
    hardcopyPath = await mkdtemp(join(tmpdir(), 'hardcopy-test-'));
    inner = new MockMemoryStore();
    store = new HardcopyMemoryStore(inner, hardcopyPath);
    await store.initialize();
  });

  afterEach(async () => {
    await rm(hardcopyPath, { recursive: true, force: true });
  });

  // ── Helpers ─────────────────────────────────────────────────

  async function listHardcopyFiles(): Promise<string[]> {
    return (await readdir(hardcopyPath)).filter(f => f.endsWith('.json'));
  }

  async function readHardcopy(id: string): Promise<Memory> {
    const content = await readFile(join(hardcopyPath, `${id}.json`), 'utf-8');
    return JSON.parse(content);
  }

  // ── Store ───────────────────────────────────────────────────

  describe('store', () => {
    it('writes a hardcopy file for each stored memory', async () => {
      const memory = await store.store({
        content: 'Test memory',
        category: 'learning',
        tags: ['test'],
      });

      const files = await listHardcopyFiles();
      expect(files).toEqual([`${memory.id}.json`]);

      const hardcopy = await readHardcopy(memory.id);
      expect(hardcopy.content).toBe('Test memory');
      expect(hardcopy.category).toBe('learning');
      expect(hardcopy.tags).toEqual(['test']);
      expect(hardcopy.id).toBe(memory.id);
    });

    it('delegates to the inner store', async () => {
      await store.store({ content: 'Test', category: 'learning', tags: [] });
      expect(inner.memories).toHaveLength(1);
    });
  });

  // ── Store batch ─────────────────────────────────────────────

  describe('storeBatch', () => {
    it('writes a hardcopy file for each memory in the batch', async () => {
      const memories = await store.storeBatch([
        { content: 'Alpha', category: 'learning', tags: ['a'] },
        { content: 'Beta', category: 'architecture', tags: ['b'] },
        { content: 'Gamma', category: 'other', tags: ['c'] },
      ]);

      const files = await listHardcopyFiles();
      expect(files).toHaveLength(3);

      for (const m of memories) {
        const hardcopy = await readHardcopy(m.id);
        expect(hardcopy.content).toBe(m.content);
      }
    });
  });

  // ── Update ──────────────────────────────────────────────────

  describe('update', () => {
    it('overwrites the hardcopy file with updated content', async () => {
      const memory = await store.store({
        content: 'Original',
        category: 'learning',
        tags: ['v1'],
      });

      await store.update(memory.id, { content: 'Updated', tags: ['v2'] });

      const files = await listHardcopyFiles();
      expect(files).toHaveLength(1);

      const hardcopy = await readHardcopy(memory.id);
      expect(hardcopy.content).toBe('Updated');
      expect(hardcopy.tags).toEqual(['v2']);
    });
  });

  // ── Delete ──────────────────────────────────────────────────

  describe('delete', () => {
    it('removes the hardcopy file', async () => {
      const memory = await store.store({
        content: 'Doomed',
        category: 'other',
        tags: [],
      });

      const filesBefore = await listHardcopyFiles();
      expect(filesBefore).toHaveLength(1);

      await store.delete(memory.id);

      const filesAfter = await listHardcopyFiles();
      expect(filesAfter).toHaveLength(0);
    });

    it('does not throw when hardcopy file does not exist', async () => {
      const memory = await store.store({
        content: 'Test',
        category: 'other',
        tags: [],
      });

      // Manually remove the hardcopy file first
      const { unlink } = await import('fs/promises');
      await unlink(join(hardcopyPath, `${memory.id}.json`));

      // Delete should not throw
      await expect(store.delete(memory.id)).resolves.not.toThrow();
    });
  });

  // ── Reads pass through ──────────────────────────────────────

  describe('read operations delegate to inner store', () => {
    it('search delegates', async () => {
      await store.store({ content: 'Searchable', category: 'learning', tags: [] });
      const results = await store.search('Searchable', 'hybrid', { limit: 10 });
      expect(results).toHaveLength(1);
    });

    it('listRecent delegates', async () => {
      await store.store({ content: 'Recent', category: 'learning', tags: [] });
      const recent = await store.listRecent(10);
      expect(recent).toHaveLength(1);
    });

    it('stats delegates', async () => {
      await store.store({ content: 'A', category: 'learning', tags: [] });
      await store.store({ content: 'B', category: 'architecture', tags: [] });
      const stats = await store.stats();
      expect(stats.totalMemories).toBe(2);
    });
  });

  // ── Hardcopy is valid JSON ──────────────────────────────────

  describe('file format', () => {
    it('writes valid, pretty-printed JSON', async () => {
      const memory = await store.store({
        content: 'Format test',
        category: 'learning',
        tags: ['format'],
      });

      const raw = await readFile(join(hardcopyPath, `${memory.id}.json`), 'utf-8');

      // Should be parseable
      const parsed = JSON.parse(raw);
      expect(parsed.id).toBe(memory.id);

      // Should be pretty-printed (contains newlines)
      expect(raw).toContain('\n');

      // Should end with a newline
      expect(raw.endsWith('\n')).toBe(true);
    });
  });
});
