'use strict';

// Canonical content fingerprinting for cross-adapter conflict detection.
//
// A *content fingerprint* is a sha256 over a NORMALISED projection of an item's
// content, computed identically by every storage adapter. This lets a base
// fingerprint recorded by one adapter (sqlite-fs, at branch fork) be compared
// against the current doc hash computed by another (postgres, at push/merge) —
// with NO shared clock. Conflict = "the remote's current content differs from
// the base I forked from."
//
// Parity is guaranteed by construction: both adapters build the projection from
// their flat read-model item via `canonicalContentDoc`, and hash it via
// `stableStringify` (recursively key-sorted), so key-insertion order and
// absent-vs-null never cause a spurious mismatch.
//
// INCLUDED (the fields that make two versions meaningfully different):
//   item: parentId, type, typeId, value, sortOrder, aspect
//   meta: owner, license, visibility, confidence, status, tags,
//         connectorId, materialized, sourceSystem, sourceExternalId,
//         completedAt, dueAt, expiresAt, deletedAt
//   payload (full structured section — the content of object/relationship items)
//
// EXCLUDED, by design:
//   - bookkeeping actors/timestamps: modifiedAt, modifiedBy, cachedAt
//     (a touch or an edit-then-revert must hash clean)
//   - identity / provenance: id, specVersion, createdAt, createdBy
//   - `search`: derived from value/payload, and adapters may compute it
//     differently — including it would flag false conflicts
//   - `files`, `layer`, `time`: not uniformly reconstructable from the postgres
//     read model today (TODO: fold in once the pg read model exposes them; see
//     `canonicalContentDoc` — additive, will re-baseline fingerprints).

import crypto from 'crypto';

const CONTENT_META_FIELDS = [
  'owner', 'license', 'visibility', 'confidence', 'status', 'tags',
  'connectorId', 'materialized', 'sourceSystem', 'sourceExternalId',
  'completedAt', 'dueAt', 'expiresAt', 'deletedAt',
] as const;

// Recursively stable JSON: object keys sorted, arrays keep order. Two adapters
// that build the same logical object therefore serialise identically.
export function stableStringify(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// Accept either a flat read-model item (postgres `rowToItem`) OR a nested
// five-section item.json doc (sqlite-fs on disk: { item, meta, search, payload,
// time }). Both flatten to the same shape so either adapter can pass its natural
// input and get an identical fingerprint.
function toFlat(input: any, sections: any): { item: any; payload: any } {
  if (input && typeof input === 'object' && input.item && typeof input.item === 'object' && input.meta) {
    return { item: { ...input.item, ...input.meta }, payload: sections.payload ?? input.payload ?? null };
  }
  return { item: input || {}, payload: sections.payload ?? input?.payload ?? null };
}

// Build the normalised content projection from a flat item OR a nested item.json
// doc, plus an optional payload override. Absent optional fields normalise to
// fixed defaults.
export function canonicalContentDoc(input: any, sections: any = {}): any {
  const { item, payload } = toFlat(input, sections);
  const meta: Record<string, any> = {};
  for (const k of CONTENT_META_FIELDS) {
    if (k === 'tags') {
      // Tag ORDER is not content — sort so a reorder isn't a conflict.
      meta[k] = Array.isArray(item.tags) ? [...item.tags].sort() : [];
    } else {
      meta[k] = item[k] ?? null;
    }
  }
  return {
    item: {
      parentId:  item.parentId ?? null,
      type:      item.type ?? null,
      typeId:    item.typeId ?? null,
      value:     item.value ?? null,
      sortOrder: item.sortOrder ?? 0,
      aspect:    item.aspect ?? null,
    },
    meta,
    payload,
  };
}

// sha256 of the canonical content projection. Pass a flat item and (optionally)
// its payload section: `contentHash(item, { payload })`.
export function contentHash(item: any, sections: any = {}): string {
  return crypto
    .createHash('sha256')
    .update(stableStringify(canonicalContentDoc(item, sections)))
    .digest('hex');
}
