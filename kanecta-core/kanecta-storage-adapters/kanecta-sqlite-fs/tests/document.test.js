'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { SqliteFsAdapter } = require('../src/adapter');

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-doc-'));
  return SqliteFsAdapter.init(root, 'test@example.com');
}

function cleanup(a) { fs.rmSync(a.root, { recursive: true, force: true }); }

// ─── DOCUMENT_TYPE_UUID ────────────────────────────────────────────────────────

describe('DOCUMENT_TYPE_UUID', () => {
  test('matches the spec seed file UUID', () => {
    expect(SqliteFsAdapter.DOCUMENT_TYPE_UUID).toBe('b4e2f1c3-a0d5-4e6f-8b9c-d7f2e1a3b5c0');
  });
});

// ─── createDocument ────────────────────────────────────────────────────────────

describe('createDocument', () => {
  test('creates an item of type "document"', () => {
    const a      = tmpAdapter();
    const target = a.create({ value: 'Root item', type: 'text' });
    const doc    = a.createDocument(target.id, 'My doc');
    expect(doc.type).toBe('document');
    expect(doc.value).toBe('My doc');
    cleanup(a);
  });

  test('sets parentId to DOCUMENT_TYPE_UUID', () => {
    const a      = tmpAdapter();
    const target = a.create({ value: 'Root item', type: 'text' });
    const doc    = a.createDocument(target.id, 'My doc');
    expect(doc.parentId).toBe(SqliteFsAdapter.DOCUMENT_TYPE_UUID);
    cleanup(a);
  });

  test('writes default payload with targetId and name', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Root item', type: 'text' });
    const doc     = a.createDocument(target.id, 'My doc');
    const payload = a.readDocumentPayload(doc.id);
    expect(payload.targetId).toBe(target.id);
    expect(payload.name).toBe('My doc');
    cleanup(a);
  });

  test('applies default expandState when not supplied', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Root item', type: 'text' });
    const doc     = a.createDocument(target.id, 'My doc');
    const payload = a.readDocumentPayload(doc.id);
    expect(payload.expandState.defaultDepth).toBe(2);
    expect(payload.expandState.exceptions).toEqual({});
    cleanup(a);
  });

  test('applies default roleMap when not supplied', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Root item', type: 'text' });
    const doc     = a.createDocument(target.id, 'My doc');
    const payload = a.readDocumentPayload(doc.id);
    expect(payload.roleMap.byDepth['1']).toBe('heading');
    expect(payload.roleMap.byDepth['2']).toBe('subheading');
    expect(payload.roleMap.byDepth['3']).toBe('body');
    cleanup(a);
  });

  test('accepts custom expandState and roleMap', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Root item', type: 'text' });
    const doc     = a.createDocument(target.id, 'Custom', {
      expandState: { defaultDepth: 5, exceptions: {} },
      roleMap:     { byDepth: { '1': 'title' }, byType: { annotation: 'caption' } },
    });
    const payload = a.readDocumentPayload(doc.id);
    expect(payload.expandState.defaultDepth).toBe(5);
    expect(payload.roleMap.byDepth['1']).toBe('title');
    expect(payload.roleMap.byType.annotation).toBe('caption');
    cleanup(a);
  });

  test('sets isOrgDefault from opts', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Root item', type: 'text' });
    const doc     = a.createDocument(target.id, 'Org default', { isOrgDefault: true });
    const payload = a.readDocumentPayload(doc.id);
    expect(payload.isOrgDefault).toBe(true);
    cleanup(a);
  });

  test('sets baseDocumentId from opts', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Root item', type: 'text' });
    const original = a.createDocument(target.id, 'Original');
    const fork     = a.createDocument(target.id, 'Fork', { baseDocumentId: original.id });
    const payload  = a.readDocumentPayload(fork.id);
    expect(payload.baseDocumentId).toBe(original.id);
    cleanup(a);
  });

  test('throws if targetId is missing', () => {
    const a = tmpAdapter();
    expect(() => a.createDocument(null, 'Bad doc')).toThrow('targetId is required');
    cleanup(a);
  });

  test('throws if name is missing', () => {
    const a      = tmpAdapter();
    const target = a.create({ value: 'Root item', type: 'text' });
    expect(() => a.createDocument(target.id, '')).toThrow('name is required');
    cleanup(a);
  });
});

// ─── writeDocumentPayload / readDocumentPayload ────────────────────────────────

describe('writeDocumentPayload / readDocumentPayload', () => {
  test('overwrites payload in full', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Root', type: 'text' });
    const doc     = a.createDocument(target.id, 'Doc');
    const updated = { targetId: target.id, name: 'Renamed', expandState: { defaultDepth: 3, exceptions: {} }, roleMap: { byDepth: {}, byType: {} }, isOrgDefault: false, baseDocumentId: null };
    a.writeDocumentPayload(doc.id, updated);
    expect(a.readDocumentPayload(doc.id).name).toBe('Renamed');
    expect(a.readDocumentPayload(doc.id).expandState.defaultDepth).toBe(3);
    cleanup(a);
  });

  test('throws if item does not exist', () => {
    const a = tmpAdapter();
    expect(() => a.writeDocumentPayload('00000000-0000-4000-8000-000000000099', {})).toThrow('not found');
    cleanup(a);
  });

  test('throws if item is not a document', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'plain', type: 'text' });
    expect(() => a.writeDocumentPayload(item.id, {})).toThrow('not a document');
    cleanup(a);
  });

  test('readDocumentPayload returns null for item with no payload', () => {
    const a    = tmpAdapter();
    const item = a.create({ value: 'plain', type: 'text' });
    expect(a.readDocumentPayload(item.id)).toBeNull();
    cleanup(a);
  });
});

// ─── listDocuments ─────────────────────────────────────────────────────────────

describe('listDocuments', () => {
  test('returns empty array when no documents target item', () => {
    const a      = tmpAdapter();
    const target = a.create({ value: 'Target', type: 'text' });
    expect(a.listDocuments(target.id)).toEqual([]);
    cleanup(a);
  });

  test('returns documents targeting a specific item', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Target', type: 'text' });
    const other   = a.create({ value: 'Other', type: 'text' });
    const doc1    = a.createDocument(target.id, 'Doc 1');
    const doc2    = a.createDocument(target.id, 'Doc 2');
    /*const docOther =*/ a.createDocument(other.id, 'Other doc');
    const docs = a.listDocuments(target.id);
    const ids  = docs.map(d => d.id);
    expect(ids).toContain(doc1.id);
    expect(ids).toContain(doc2.id);
    expect(ids).not.toContain('Other doc');
    expect(docs.length).toBe(2);
    cleanup(a);
  });

  test('excludes soft-deleted documents', () => {
    const a      = tmpAdapter();
    const target = a.create({ value: 'Target', type: 'text' });
    const doc    = a.createDocument(target.id, 'To be deleted');
    expect(a.listDocuments(target.id)).toHaveLength(1);
    a.softDelete(doc.id);
    expect(a.listDocuments(target.id)).toHaveLength(0);
    cleanup(a);
  });

  test('returns all documents regardless of visibility', () => {
    const a      = tmpAdapter();
    const target = a.create({ value: 'Target', type: 'text' });
    a.createDocument(target.id, 'Private doc', { visibility: 'private' });
    a.createDocument(target.id, 'Org doc',     { visibility: 'org' });
    expect(a.listDocuments(target.id)).toHaveLength(2);
    cleanup(a);
  });
});

// ─── isOrgDefault flag ─────────────────────────────────────────────────────────

describe('org default flag', () => {
  test('only one org-default document visible per target (by convention)', () => {
    const a       = tmpAdapter();
    const target  = a.create({ value: 'Target', type: 'text' });
    a.createDocument(target.id, 'Default', { isOrgDefault: true });
    a.createDocument(target.id, 'Alt',     { isOrgDefault: false });
    const docs    = a.listDocuments(target.id);
    const payload = a.readDocumentPayload(docs.find(d => d.value === 'Default').id);
    expect(payload.isOrgDefault).toBe(true);
    expect(docs).toHaveLength(2);
    cleanup(a);
  });
});

// ─── payload persistence across open/close ────────────────────────────────────

describe('payload persistence', () => {
  test('payload survives adapter re-open', () => {
    const root   = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-doc-persist-'));
    const a      = SqliteFsAdapter.init(root, 'test@example.com');
    const target = a.create({ value: 'Root', type: 'text' });
    const doc    = a.createDocument(target.id, 'Persisted doc', {
      expandState: { defaultDepth: 4, exceptions: {} },
    });
    const b       = SqliteFsAdapter.open(root);
    const payload = b.readDocumentPayload(doc.id);
    expect(payload.name).toBe('Persisted doc');
    expect(payload.expandState.defaultDepth).toBe(4);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
