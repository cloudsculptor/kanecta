'use strict';

// Semantic search (embeddings) — same surface and semantics as the Postgres
// adapter's suite, plus the filesystem-adapter storage model the spec mandates
// («Search»): the vector is a raw float32 embedding.bin sidecar next to
// item.json, metadata lives in the doc's search section, and perf_embeddings
// is a derived index copy that a rebuild re-ingests with no API calls.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter } from '../src/adapter';

const EMBEDDINGS = { provider: 'mock', dimensions: 16 };

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-semantic-'));
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

describe('semantic search (embeddings)', () => {
  let a: any;
  beforeEach(() => {
    a = SqliteFsAdapter.init(tmpRoot(), 'test@example.com', { embeddings: EMBEDDINGS });
  });
  afterEach(() => cleanup(a));

  test('embedItem stores the vector and skips re-embedding unchanged content', async () => {
    const item = a.create({ value: 'the committee fundraising plan', type: 'text' });

    expect(await a.embedItem(item.id)).toBe(true);
    const row = a._openDb().prepare(
      'SELECT content_hash, embedding FROM perf_embeddings WHERE item_id = ?',
    ).get(item.id);
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.embedding.byteLength).toBe(EMBEDDINGS.dimensions * 4);

    // Unchanged content → no-op.
    expect(await a.embedItem(item.id)).toBe(false);

    // Changed content → re-embeds under a new hash.
    a.update(item.id, { value: 'the committee bake sale plan' });
    expect(await a.embedItem(item.id)).toBe(true);
    const row2 = a._openDb().prepare(
      'SELECT content_hash FROM perf_embeddings WHERE item_id = ?',
    ).get(item.id);
    expect(row2.content_hash).not.toBe(row.content_hash);
  });

  test('the vector lives as an embedding.bin sidecar with search metadata in the doc', async () => {
    const item = a.create({ value: 'sidecar storage check', type: 'text' });
    await a.embedItem(item.id);

    // Spec «Search»: never inlined — a raw float32 sidecar next to item.json.
    const bin = path.join(a._itemDir(item.id), 'embedding.bin');
    expect(fs.existsSync(bin)).toBe(true);
    expect(fs.statSync(bin).size).toBe(EMBEDDINGS.dimensions * 4);

    const doc = a._readItemJson(item.id);
    expect(doc.meta.files.embedding).toBe('embedding.bin');
    expect(doc.search.embedding).toMatchObject({ model: 'mock-embed', dimensions: 16 });
    expect(doc.search.corpusHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(doc)).not.toContain('"embedding":['); // no inlined vector
  });

  test('a rebuilt index re-ingests sidecar vectors without any API calls', async () => {
    const item = a.create({ value: 'survives the rebuild', type: 'text' });
    await a.embedItem(item.id);
    const before = a._openDb().prepare(
      'SELECT embedding, content_hash FROM perf_embeddings WHERE item_id = ?',
    ).get(item.id);

    // Nuke the derived index and reopen with NO provider: the vector must come
    // back purely from the filesystem (embedding.bin + the doc's search section).
    const root = a.root;
    const dbPath = path.join(a._branchRoot(), 'index.db');
    a._db.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + '-wal', { force: true });
    fs.rmSync(dbPath + '-shm', { force: true });

    const reopened = SqliteFsAdapter.open(root);
    const after = reopened._openDb().prepare(
      'SELECT embedding, content_hash FROM perf_embeddings WHERE item_id = ?',
    ).get(item.id);
    expect(after).toBeDefined();
    expect(after.content_hash).toBe(before.content_hash);
    expect(Buffer.compare(after.embedding, before.embedding)).toBe(0);
  });

  test('processPendingEmbeddings drains the queue', async () => {
    const item = a.create({ value: 'queued for embedding', type: 'text' });
    const db = a._openDb();
    expect(db.prepare('SELECT 1 FROM perf_embedding_queue WHERE item_id = ?').get(item.id)).toBeDefined();

    const result = await a.processPendingEmbeddings({ limit: 100 });
    expect(result.embedded).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM perf_embedding_queue').get().n).toBe(0);
  });

  test('semanticSearch ranks by cosine distance and respects rootId', async () => {
    const food  = a.create({ value: 'apple banana orchard fruit harvest', type: 'text' });
    const code  = a.create({ value: 'typescript compiler strict null checks', type: 'text' });
    const child = a.create({ value: 'apple pie recipe with orchard fruit', type: 'text', parentId: food.id });
    await a.processPendingEmbeddings({ limit: 100 });

    const hits = await a.semanticSearch('orchard fruit apple', { limit: 2 });
    const ids = hits.map((h: any) => h.id);
    expect(ids).toContain(food.id);
    expect(ids).not.toContain(code.id);

    // Subtree scope: only the child is inside food's subtree besides food itself.
    const scoped = await a.semanticSearch('apple', { rootId: child.id, limit: 10 });
    expect(scoped.map((h: any) => h.id)).toEqual([child.id]);
  });

  test('semanticSearch and embedItem demand a provider; embeddingsEnabled reflects it', async () => {
    const bare = SqliteFsAdapter.init(tmpRoot(), 'test@example.com');
    try {
      expect(bare.embeddingsEnabled).toBe(false);
      await expect(bare.semanticSearch('anything')).rejects.toThrow(/embedding provider/i);
      await expect(bare.embedItem('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/embedding provider/i);
    } finally {
      cleanup(bare);
    }
  });

  test('enabled: false keeps generating embeddings but refuses to serve queries', async () => {
    const paused = SqliteFsAdapter.init(tmpRoot(), 'test@example.com', {
      embeddings: { ...EMBEDDINGS, enabled: false },
    });
    try {
      expect(paused.embeddingsEnabled).toBe(false);
      const item = paused.create({ value: 'still embeds while paused', type: 'text' });
      expect(await paused.embedItem(item.id)).toBe(true);
      await expect(paused.semanticSearch('anything')).rejects.toThrow(/disabled/i);
    } finally {
      cleanup(paused);
    }
  });

  test('hard delete cascades the vector and queue rows away', async () => {
    const item = a.create({ value: 'doomed item', type: 'text' });
    await a.embedItem(item.id);
    a.delete(item.id);
    const db = a._openDb();
    expect(db.prepare('SELECT 1 FROM perf_embeddings WHERE item_id = ?').get(item.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM perf_embedding_queue WHERE item_id = ?').get(item.id)).toBeUndefined();
  });
});
