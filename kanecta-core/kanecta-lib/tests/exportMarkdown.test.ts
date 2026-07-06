'use strict';

import { exportMarkdown, _roleToMarkdown } from '../src/exportMarkdown.ts';

// ─── _roleToMarkdown unit tests ────────────────────────────────────────────────

describe('_roleToMarkdown', () => {
  test('title → # heading', () => {
    expect(_roleToMarkdown('title', 'My Document')).toBe('# My Document');
  });

  test('heading → ## heading', () => {
    expect(_roleToMarkdown('heading', 'Section')).toBe('## Section');
  });

  test('subheading → ### heading', () => {
    expect(_roleToMarkdown('subheading', 'Subsection')).toBe('### Subsection');
  });

  test('body → plain text', () => {
    expect(_roleToMarkdown('body', 'Some body text')).toBe('Some body text');
  });

  test('caption → italics', () => {
    expect(_roleToMarkdown('caption', 'A caption')).toBe('*A caption*');
  });

  test('list-item → bullet', () => {
    expect(_roleToMarkdown('list-item', 'Item')).toBe('- Item');
  });

  test('code-block → fenced code', () => {
    expect(_roleToMarkdown('code-block', 'const x = 1;')).toBe('```\nconst x = 1;\n```');
  });

  test('ignore → null', () => {
    expect(_roleToMarkdown('ignore', 'anything')).toBeNull();
  });

  test('empty body returns null', () => {
    expect(_roleToMarkdown('body', '')).toBeNull();
  });
});

// ─── Mock adapter factory ──────────────────────────────────────────────────────

function makeAdapter(items, documentPayloads = {}) {
  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));
  const childMap = {};
  for (const item of items) {
    if (item.parentId) {
      childMap[item.parentId] = childMap[item.parentId] || [];
      childMap[item.parentId].push(item);
    }
  }
  return {
    get: id => itemMap[id] ?? null,
    children: id => childMap[id] ?? [],
    readDocumentPayload: id => documentPayloads[id] ?? null,
  };
}

function item(id, value, type = 'text', parentId = null, typeId = null) {
  return { id, value, type, parentId, typeId };
}

// ─── exportMarkdown — basic rendering ─────────────────────────────────────────

describe('exportMarkdown — basic rendering', () => {
  test('throws if item is not a document', async () => {
    const adapter = makeAdapter([item('doc1', 'not a doc', 'text')], {});
    await expect(exportMarkdown(adapter, 'doc1')).rejects.toThrow('not a document');
  });

  test('throws if document has no targetId', async () => {
    const adapter = makeAdapter(
      [item('doc1', 'My doc', 'document')],
      { doc1: { name: 'My doc' } },
    );
    await expect(exportMarkdown(adapter, 'doc1')).rejects.toThrow('no targetId');
  });

  test('renders empty string for target with no children', async () => {
    const adapter = makeAdapter(
      [
        item('doc1', 'My doc', 'document'),
        item('tgt1', 'Root',   'text'),
      ],
      { doc1: { targetId: 'tgt1', name: 'My doc', roleMap: {}, expandState: {} } },
    );
    const md = await exportMarkdown(adapter, 'doc1');
    expect(md).toBe('');
  });

  test('renders direct children with byDepth roles', async () => {
    const target = item('tgt1', 'Root', 'text');
    const child  = item('ch1',  'Chapter 1', 'text', 'tgt1');
    const doc    = item('doc1', 'My doc', 'document');
    const adapter = makeAdapter([target, child, doc], {
      doc1: {
        targetId: 'tgt1',
        name: 'My doc',
        roleMap: { byDepth: { '1': 'heading' }, byType: {} },
        expandState: { defaultDepth: 1, exceptions: {} },
      },
    });
    const md = await exportMarkdown(adapter, 'doc1');
    expect(md).toBe('## Chapter 1');
  });

  test('renders nested tree with multiple depth roles', async () => {
    const tgt  = item('tgt', 'Root', 'text');
    const h1   = item('h1',  'Section A', 'text', 'tgt');
    const h2   = item('h2',  'Body text', 'text', 'h1');
    const doc  = item('doc', 'Full', 'document');
    const adapter = makeAdapter([tgt, h1, h2, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Full',
        roleMap: { byDepth: { '1': 'heading', '2': 'body' }, byType: {} },
        expandState: { defaultDepth: 2, exceptions: {} },
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).toBe('## Section A\n\nBody text');
  });

  test('title role at depth 0 renders the target item itself', async () => {
    const tgt  = item('tgt', 'The Root', 'text');
    const doc  = item('doc', 'Title test', 'document');
    const adapter = makeAdapter([tgt, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Title test',
        roleMap: { byDepth: { '0': 'title' }, byType: {} },
        expandState: { defaultDepth: 0, exceptions: {} },
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).toBe('# The Root');
  });
});

// ─── exportMarkdown — byType overrides ────────────────────────────────────────

describe('exportMarkdown — byType overrides', () => {
  test('byType string key overrides byDepth', async () => {
    const tgt   = item('tgt', 'Root', 'text');
    const ann   = item('ann', 'A caption', 'annotation', 'tgt');
    const doc   = item('doc', 'Test', 'document');
    const adapter = makeAdapter([tgt, ann, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Test',
        roleMap: { byDepth: { '1': 'body' }, byType: { annotation: 'caption' } },
        expandState: { defaultDepth: 1, exceptions: {} },
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).toBe('*A caption*');
  });

  test('byType UUID key overrides string key and byDepth', async () => {
    const typeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const tgt    = item('tgt', 'Root', 'text');
    const obj    = { ...item('obj', 'Object value', 'object', 'tgt'), typeId };
    const doc    = item('doc', 'Test', 'document');
    const adapter = makeAdapter([tgt, obj, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Test',
        roleMap: { byDepth: { '1': 'body' }, byType: { object: 'subheading', [typeId]: 'heading' } },
        expandState: { defaultDepth: 1, exceptions: {} },
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).toBe('## Object value');
  });
});

// ─── exportMarkdown — ignore role ─────────────────────────────────────────────

describe('exportMarkdown — ignore role', () => {
  test('ignore suppresses item and its descendants', async () => {
    const tgt   = item('tgt',  'Root', 'text');
    const kept  = item('kpt',  'Kept',  'text', 'tgt');
    const skip  = item('skip', 'Skip',  'annotation', 'tgt');
    const child = item('chd',  'Child of skip', 'text', 'skip');
    const doc   = item('doc',  'Test', 'document');
    const adapter = makeAdapter([tgt, kept, skip, child, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Test',
        roleMap: { byDepth: { '1': 'body', '2': 'body' }, byType: { annotation: 'ignore' } },
        expandState: { defaultDepth: 2, exceptions: {} },
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).toContain('Kept');
    expect(md).not.toContain('Skip');
    expect(md).not.toContain('Child of skip');
  });
});

// ─── exportMarkdown — expandState exceptions ───────────────────────────────────

describe('exportMarkdown — expandState exceptions', () => {
  test('false exception collapses a subtree', async () => {
    const tgt   = item('tgt',  'Root', 'text');
    const h1    = item('h1',   'Section A', 'text', 'tgt');
    const h1c   = item('h1c',  'Child of A', 'text', 'h1');
    const h2    = item('h2',   'Section B', 'text', 'tgt');
    const h2c   = item('h2c',  'Child of B', 'text', 'h2');
    const doc   = item('doc',  'Test', 'document');
    const adapter = makeAdapter([tgt, h1, h1c, h2, h2c, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Test',
        roleMap: { byDepth: { '1': 'heading', '2': 'body' }, byType: {} },
        expandState: { defaultDepth: 2, exceptions: { h1: false } },
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).not.toContain('Section A');
    expect(md).not.toContain('Child of A');
    expect(md).toContain('Section B');
    expect(md).toContain('Child of B');
  });

  test('integer exception expands a subtree further than defaultDepth', async () => {
    const tgt  = item('tgt', 'Root', 'text');
    const h1   = item('h1',  'L1', 'text', 'tgt');
    const h2   = item('h2',  'L2', 'text', 'h1');
    const h3   = item('h3',  'L3', 'text', 'h2');
    const doc  = item('doc', 'Test', 'document');
    const adapter = makeAdapter([tgt, h1, h2, h3, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Test',
        roleMap: { byDepth: { '1': 'heading', '2': 'body', '3': 'caption' }, byType: {} },
        // defaultDepth = 2 normally stops at h2; exception for h1 extends to depth 3
        expandState: { defaultDepth: 2, exceptions: { h1: 3 } },
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).toContain('L1');
    expect(md).toContain('L2');
    expect(md).toContain('L3');
  });

  test('defaultDepth = Infinity renders all descendants', async () => {
    const tgt  = item('tgt', 'Root', 'text');
    const a    = item('a',   'A', 'text', 'tgt');
    const b    = item('b',   'B', 'text', 'a');
    const c    = item('c',   'C', 'text', 'b');
    const doc  = item('doc', 'Test', 'document');
    const adapter = makeAdapter([tgt, a, b, c, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Test',
        roleMap: { byDepth: {}, byType: {} },
        expandState: {},
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).toContain('A');
    expect(md).toContain('B');
    expect(md).toContain('C');
  });
});

// ─── exportMarkdown — empty value items ───────────────────────────────────────

describe('exportMarkdown — null/empty values', () => {
  test('items with null value do not add empty lines', async () => {
    const tgt  = item('tgt', 'Root', 'text');
    const ch   = { ...item('ch', null, 'text', 'tgt') };
    const doc  = item('doc', 'Test', 'document');
    const adapter = makeAdapter([tgt, ch, doc], {
      doc: {
        targetId: 'tgt',
        name: 'Test',
        roleMap: { byDepth: { '1': 'body' }, byType: {} },
        expandState: { defaultDepth: 1, exceptions: {} },
      },
    });
    const md = await exportMarkdown(adapter, 'doc');
    expect(md).toBe('');
  });
});
