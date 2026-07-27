import { describe, it, expect } from 'vitest';
import { contentHash, canonicalContentDoc, stableStringify } from './canonical';

// A nested five-section item.json doc (sqlite-fs on-disk shape).
const nestedDoc = {
  item: { id: 'i1', parentId: 'p1', type: 'note', typeId: null, value: 'hello', sortOrder: 3, aspect: null },
  meta: {
    specVersion: '1.4.0', owner: 'u1', license: null, visibility: 'private', confidence: null,
    status: 'open', tags: ['b', 'a'], createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-06-01T00:00:00.000Z',
    createdBy: 'u1', modifiedBy: 'u2', completedAt: null, dueAt: null, expiresAt: null, deletedAt: null,
    cachedAt: '2026-06-01T00:00:00.000Z', connectorId: null, materialized: null, files: { 'a.txt': 'x' },
    layer: 'L1', sourceSystem: null, sourceExternalId: null,
  },
  search: 'hello world derived', payload: { k: 1 }, time: { at: '2026-01-01' },
};

// The equivalent postgres flat read-model item (rowToItem shape) + payload section.
const flatItem = {
  id: 'i1', specVersion: '1.4.0', parentId: 'p1', value: 'hello', type: 'note', typeId: null,
  owner: 'u1', license: null, sortOrder: 3, confidence: null, status: 'open', tags: ['a', 'b'],
  createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2099-12-31T00:00:00.000Z', // different clock!
  createdBy: 'u1', modifiedBy: 'someone-else', cachedAt: null, expiresAt: null, deletedAt: null,
  connectorId: null, materialized: null, completedAt: null, dueAt: null, visibility: 'private',
  aspect: null, sourceSystem: null, sourceExternalId: null,
};

describe('canonical contentHash — cross-adapter parity', () => {
  it('nested sqlite-fs doc and flat pg item with the same content hash identically', () => {
    // pg passes payload via sections; files/layer/search/time differ or are absent — must not matter.
    expect(contentHash(flatItem, { payload: { k: 1 } })).toBe(contentHash(nestedDoc));
  });

  it('excludes bookkeeping: modifiedAt/modifiedBy/cachedAt never change the hash', () => {
    const touched = { ...nestedDoc, meta: { ...nestedDoc.meta, modifiedAt: '2030-01-01T00:00:00.000Z', modifiedBy: 'zzz', cachedAt: '2030-01-01T00:00:00.000Z' } };
    expect(contentHash(touched)).toBe(contentHash(nestedDoc));
  });

  it('excludes files/layer/search/time (v1 deferral) — differing there hashes clean', () => {
    const other = { ...nestedDoc, search: 'totally different', time: { at: '1999' }, meta: { ...nestedDoc.meta, files: { 'z.bin': 'q' }, layer: 'L9' } };
    expect(contentHash(other)).toBe(contentHash(nestedDoc));
  });

  it('excludes provenance: createdAt/createdBy/specVersion do not change the hash', () => {
    const other = { ...nestedDoc, meta: { ...nestedDoc.meta, createdAt: '1990-01-01T00:00:00.000Z', createdBy: 'x', specVersion: '1.3.0' } };
    expect(contentHash(other)).toBe(contentHash(nestedDoc));
  });

  it('tag ORDER is not content (sorted before hashing)', () => {
    const reordered = { ...nestedDoc, meta: { ...nestedDoc.meta, tags: ['a', 'b'] } };
    expect(contentHash(reordered)).toBe(contentHash(nestedDoc));
  });

  it('DETECTS a real content change: value differs → different hash', () => {
    const edited = { ...nestedDoc, item: { ...nestedDoc.item, value: 'goodbye' } };
    expect(contentHash(edited)).not.toBe(contentHash(nestedDoc));
  });

  it('DETECTS a real content change: status differs → different hash', () => {
    const edited = { ...nestedDoc, meta: { ...nestedDoc.meta, status: 'done' } };
    expect(contentHash(edited)).not.toBe(contentHash(nestedDoc));
  });

  it('DETECTS a real content change: payload differs → different hash', () => {
    expect(contentHash(flatItem, { payload: { k: 2 } })).not.toBe(contentHash(flatItem, { payload: { k: 1 } }));
  });

  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('canonicalContentDoc normalises absent optional fields to fixed defaults', () => {
    expect(canonicalContentDoc({ id: 'x', value: 'v', type: 't' })).toEqual({
      item: { parentId: null, type: 't', typeId: null, value: 'v', sortOrder: 0, aspect: null },
      meta: { owner: null, license: null, visibility: null, confidence: null, status: null, tags: [],
              connectorId: null, materialized: null, sourceSystem: null, sourceExternalId: null,
              completedAt: null, dueAt: null, expiresAt: null, deletedAt: null },
      payload: null,
    });
  });
});
