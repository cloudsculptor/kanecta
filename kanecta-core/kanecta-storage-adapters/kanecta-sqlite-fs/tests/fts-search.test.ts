'use strict';

// Full-text search (FTS5) + hybrid search — the sqlite analogue of the
// Postgres adapter's perf_search/tsvector surface: search(query, { rootId,
// limit }) ranked by BM25, hybridSearch fusing FTS with semantic results
// (falling back to plain FTS when embeddings are unconfigured/paused).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter } from '../src/adapter';

function tmpAdapter(opts: any = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-fts-'));
  return SqliteFsAdapter.init(root, 'test@example.com', opts);
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

describe('full-text search (FTS5)', () => {
  let a: any;
  beforeEach(() => { a = tmpAdapter(); });
  afterEach(() => cleanup(a));

  test('finds items by value, ranked, and misses non-matches', () => {
    const hit  = a.create({ value: 'quarterly fundraising report for the committee', type: 'text' });
    a.create({ value: 'typescript strict null checks', type: 'text' });

    const results = a.search('fundraising committee');
    expect(results.map((r: any) => r.id)).toContain(hit.id);
    expect(results.map((r: any) => r.value)).not.toContain('typescript strict null checks');
  });

  test('matches payload values, not just item value', () => {
    const typeItem = a.createType('contact', {
      icon: 'Person',
      schema: {
        meta: { icon: 'Person', description: 'a contact', details: '', keywords: '', tags: '', 'ai-instructions': { claude: '' } },
        jsonSchema: {
          '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '',
          title: 'contact', type: 'object',
          properties: { organisation: { type: 'string', 'x-id': '44444444-4444-4444-8444-000000000001' } },
          required: [], additionalProperties: false,
        },
      },
    });
    const item = a.create({
      value: 'someone', type: 'object', typeId: typeItem.metadata.id,
      objectData: { organisation: 'Featherston Community Hub' },
    });

    const results = a.search('featherston');
    expect(results.map((r: any) => r.id)).toContain(item.id);
  });

  test('updates and deletes keep the index truthful', () => {
    // Unique tokens: built-in type items are searchable too (their schema
    // descriptions are real content), so common words would cross-match.
    const item = a.create({ value: 'the orangutan wording', type: 'text' });
    expect(a.search('orangutan').map((r: any) => r.id)).toContain(item.id);

    a.update(item.id, { value: 'wallaby text entirely' });
    expect(a.search('orangutan')).toEqual([]);
    expect(a.search('wallaby').map((r: any) => r.id)).toContain(item.id);

    a.delete(item.id);
    expect(a.search('wallaby')).toEqual([]);
  });

  test('rootId scopes to a subtree', () => {
    const parent  = a.create({ value: 'projects folder', type: 'text' });
    const inside  = a.create({ value: 'grant application draft', type: 'text', parentId: parent.id });
    a.create({ value: 'grant application FINAL', type: 'text' });

    const scoped = a.search('grant application', { rootId: parent.id });
    expect(scoped.map((r: any) => r.id)).toEqual([inside.id]);
  });

  test('operator characters in the query are input, never syntax', () => {
    a.create({ value: 'plain content', type: 'text' });
    // Raw FTS5 would throw on these; plainto-style sanitising must not.
    expect(() => a.search('"unbalanced OR (NEAR')).not.toThrow();
    expect(a.search('plain-content*').length).toBeGreaterThan(0); // tokenises to plain, content
    expect(a.search('!!!')).toEqual([]);
  });

  test('a rebuilt index restores the FTS rows', () => {
    const item = a.create({ value: 'survives the rebuild too', type: 'text' });
    const dbPath = path.join(a._branchRoot(), 'index.db');
    a._db.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + '-wal', { force: true });
    fs.rmSync(dbPath + '-shm', { force: true });

    const reopened = SqliteFsAdapter.open(a.root);
    expect(reopened.search('survives rebuild').map((r: any) => r.id)).toContain(item.id);
  });
});

describe('hybrid search', () => {
  test('falls back to plain FTS without a provider', async () => {
    const a = tmpAdapter();
    try {
      const item = a.create({ value: 'hybrid fallback content', type: 'text' });
      expect(a.embeddingsEnabled).toBe(false);
      const results = await a.hybridSearch('hybrid fallback');
      expect(results.map((r: any) => r.id)).toContain(item.id);
    } finally {
      cleanup(a);
    }
  });

  test('fuses FTS and semantic rankings when embeddings are on', async () => {
    const a = tmpAdapter({ embeddings: { provider: 'mock', dimensions: 16 } });
    try {
      const fruit = a.create({ value: 'apple banana orchard fruit', type: 'text' });
      const tools = a.create({ value: 'hammer spanner toolbox', type: 'text' });
      await a.processPendingEmbeddings({ limit: 100 });

      const results = await a.hybridSearch('orchard fruit');
      const ids = results.map((r: any) => r.id);
      expect(ids[0]).toBe(fruit.id);   // top-ranked in BOTH lists → wins the fusion
      expect(ids).not.toContain(tools.id);
    } finally {
      cleanup(a);
    }
  });
});
