// introspect — Gate 1's flagship tool.
//
// Turns a parsed source table (`SourceTable`) into a Kanecta `type` item whose
// projection (via @kanecta/schema-compiler) reproduces an equivalent table, plus a
// seams/fidelity report that NAMES every intentional delta rather than hiding it.
// Pure and deterministic: same input → same type item (deterministic UUIDv5 ids).
//
// The mapping follows the converter spec:
//   * a single UUID primary key becomes the item id (Seam 1) — not an obj_ column;
//   * a composite / non-UUID (serial) primary key becomes a surrogate item_id plus
//     a UNIQUE index reproducing the old guarantee (Seam 2 — the one real delta);
//   * a FK column becomes a typeId reference (its DB FK now targets items(id),
//     Seam 3) — the target type UUID is resolved via opts.typeIdForTable or
//     reported for a second pass;
//   * envelope-overlapping columns (created_at / sort_order / soft-delete / …) are
//     kept as obj_ columns by default (faithful mirror) and only *reported* as
//     Seam-4 candidates — unless the caller opts them into native storage;
//   * every source index is transcribed into the type's `indexes` field (Seam 5).

import { createHash } from 'node:crypto';
import type {
  SourceTable,
  SourceColumn,
  IntrospectOptions,
  IntrospectResult,
  IntrospectReport,
  Seam,
} from './types.ts';

const ROOT_UUID = '00000000-0000-0000-0000-000000000000';

// Columns that overlap the native item/meta envelope — reported as Seam-4
// candidates (kept as columns by default for a faithful mirror).
const ENVELOPE_CANDIDATES = new Set([
  'id', 'created_at', 'updated_at', 'modified_at', 'sort_order', 'deleted_at', 'archived_at',
]);
const SOFT_DELETE_COLUMNS = new Set(['deleted_at', 'archived_at', 'deleted_datetime']);

export function snakeToCamel(s: string): string {
  return s.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export function snakeToPascal(s: string): string {
  return s
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** Deterministic UUIDv5-style id from a seed string (so re-runs are stable). */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex').slice(0, 32).split('');
  h[12] = '5'; // version 5
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16); // RFC variant
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// Map a raw source SQL type to a JSON-Schema property definition (portable scalars).
function jsonSchemaForType(sqlType: string): { type: string; format?: string; note?: string } {
  const t = sqlType.toLowerCase().trim();
  if (t === 'uuid') return { type: 'string', format: 'uuid' };
  if (/^(text|varchar|character varying|char|character|citext|clob|name)/.test(t)) return { type: 'string' };
  if (/^(smallint|integer|int|int2|int4|int8|bigint|serial|bigserial|smallserial)/.test(t)) return { type: 'integer' };
  if (/^(numeric|decimal|real|double|float|money|dec)/.test(t)) return { type: 'number' };
  if (/^bool/.test(t)) return { type: 'boolean' };
  if (/^timestamp/.test(t) || t === 'timestamptz') return { type: 'string', format: 'date-time' };
  if (t === 'date') return { type: 'string', format: 'date' };
  if (/^time/.test(t)) return { type: 'string' };
  if (/^(json|jsonb)/.test(t)) return { type: 'string', note: 'json-column' };
  return { type: 'string', note: `unmapped source type "${sqlType}" → string` };
}

/** Convert a parsed source table into a Kanecta type item + a fidelity report. */
export function introspect(table: SourceTable, opts: IntrospectOptions = {}): IntrospectResult {
  const typeValue = opts.typeValue ?? table.name.replace(/_/g, '-');
  const typeName = opts.typeName ?? snakeToPascal(table.name);
  const typeId = opts.typeId ?? deterministicUuid(`kanecta-converter:type:${typeValue}`);
  const seams: Seam[] = [];
  const notes: string[] = [];

  const pk = table.primaryKey ?? [];
  const fkByColumn = new Map((table.foreignKeys ?? []).map((fk) => [fk.column, fk]));
  const envelopeOptIn = new Set(opts.envelopeColumns ?? []);

  // ── Primary-key handling ─────────────────────────────────────────────────
  const columnByName = new Map(table.columns.map((c) => [c.name, c]));
  const singlePk = pk.length === 1 ? columnByName.get(pk[0]) : undefined;
  const pkIsUuid = !!singlePk && jsonSchemaForType(singlePk.sqlType).format === 'uuid';

  // Columns that become obj_ properties (everything except the item-id PK and any
  // caller-opted envelope columns).
  const skip = new Set<string>(envelopeOptIn);
  if (pk.length === 1 && pkIsUuid) {
    skip.add(pk[0]); // Seam 1 — the UUID PK becomes the item id.
    seams.push({ kind: 'id-to-item-id', detail: `PK "${pk[0]}" (uuid) → item id (obj_ column "item_id").` });
    if (singlePk!.default && /gen_random_uuid|uuid_generate/i.test(singlePk!.default)) {
      seams.push({ kind: 'non-deterministic-seed-uuid', detail: `PK "${pk[0]}" defaults to a random UUID — preserve existing values on backfill; don't re-mint (Gap D).` });
    }
  } else if (pk.length >= 1) {
    // Seam 2 — surrogate item_id + a UNIQUE index reproducing the old guarantee.
    seams.push({
      kind: 'composite-pk-surrogate',
      detail: `${pk.length > 1 ? 'Composite' : 'Non-UUID'} PK (${pk.join(', ')}) → surrogate item_id + UNIQUE (${pk.join(', ')}). One extra column; same uniqueness.`,
    });
  }

  // ── Properties ───────────────────────────────────────────────────────────
  const properties: Record<string, any> = {};
  const required: string[] = [];
  const propNames: string[] = [];
  const references: IntrospectReport['references'] = [];
  const xGraphqlFieldsByProp: Record<string, any> = {};

  for (const col of table.columns) {
    if (skip.has(col.name)) {
      seams.push({ kind: 'envelope-overlap', detail: `Column "${col.name}" mapped to the native item/meta envelope (opted in).` });
      continue;
    }
    const propName = snakeToCamel(col.name);
    const js = jsonSchemaForType(col.sqlType);
    const prop: any = { 'x-id': deterministicUuid(`${typeValue}:${col.name}`), type: js.type };
    if (js.format) prop.format = js.format;
    if (js.note === 'json-column') seams.push({ kind: 'json-column', detail: `Column "${col.name}" is JSON — stored as text; consider decomposing into a child type.` });
    else if (js.note) notes.push(js.note);

    // FK column → a typeId reference (Seam 3).
    const fk = fkByColumn.get(col.name);
    if (fk) {
      const resolved = opts.typeIdForTable?.(fk.references.table);
      if (resolved) prop.typeId = resolved;
      prop.format = 'uuid';
      references.push({ field: propName, targetTable: fk.references.table, resolved: !!resolved });
      seams.push({ kind: 'fk-to-items', detail: `FK "${col.name}" → items(id) (target type ${resolved ? 'resolved' : 'UNRESOLVED — second pass'}: ${fk.references.table}).` });
    }

    // Soft-delete columns are stored but hidden from GraphQL.
    if (SOFT_DELETE_COLUMNS.has(col.name)) xGraphqlFieldsByProp[propName] = { expose: false };

    // Envelope candidates kept as columns (faithful mirror) — reported only.
    if (ENVELOPE_CANDIDATES.has(col.name) && col.name !== 'id') {
      notes.push(`"${col.name}" overlaps the native envelope (Seam 4) — kept as a column for fidelity; could map to native.`);
    }
    // Non-deterministic seed UUIDs are FK-target hazards (Gap D).
    if (js.format === 'uuid' && col.default && /gen_random_uuid|uuid_generate/i.test(col.default)) {
      seams.push({ kind: 'non-deterministic-seed-uuid', detail: `"${col.name}" defaults to a random UUID — if it is a FK target, import existing values, don't re-mint (Gap D).` });
    }

    properties[propName] = prop;
    propNames.push(propName);
    if (!col.nullable) required.push(propName);
  }

  // ── Indexes (Seam 5) ─────────────────────────────────────────────────────
  const indexes: any[] = [];
  for (const idx of table.indexes ?? []) {
    indexes.push({
      fields: idx.columns.map(snakeToCamel),
      ...(idx.unique ? { unique: true } : {}),
      ...(idx.where ? { where: idx.where } : {}),
    });
    seams.push({ kind: 'index-transcribed', detail: `Index (${idx.columns.join(', ')})${idx.unique ? ' UNIQUE' : ''} → type indexes.` });
  }
  // Seam 2's surrogate-unique index.
  if (!(pk.length === 1 && pkIsUuid) && pk.length >= 1) {
    indexes.push({ fields: pk.map(snakeToCamel), unique: true });
  }

  // Per-property x-graphql (e.g. expose:false on soft-delete) folds into properties.
  for (const [p, xg] of Object.entries(xGraphqlFieldsByProp)) {
    properties[p]['x-graphql'] = xg;
  }

  // Known fidelity nuance discovered while building: @kanecta/schema-compiler maps
  // string+format:date-time → TEXT (ISO-string storage), NOT TIMESTAMPTZ, so a
  // source timestamp column projects to TEXT. Surface it rather than hide it.
  if (Object.values(properties).some((p: any) => p.format === 'date-time')) {
    notes.push('date-time columns project to TEXT under @kanecta/schema-compiler (source TIMESTAMPTZ → TEXT) — a fidelity nuance / potential compiler gap.');
  }

  const primaryField = pickPrimaryField(table, propNames);

  const typeItem = {
    item: { id: typeId, parentId: opts.parentId ?? ROOT_UUID, type: 'type', typeId: null, value: typeValue, sortOrder: null },
    meta: { specVersion: '1.4.0', owner: opts.owner ?? 'kanecta', visibility: 'public', tags: ['converted'] },
    search: null,
    payload: {
      meta: {
        description: `Converted from source table "${table.name}".`,
        ...(primaryField ? { primaryField } : {}),
      },
      jsonSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: `https://kanecta.org/types/${typeValue}`,
        title: typeName,
        type: 'object',
        'x-graphql': { name: typeName },
        properties,
        required,
      },
      ...(indexes.length ? { indexes } : {}),
    },
  };

  const report: IntrospectReport = {
    sourceTable: table.name,
    typeName,
    typeValue,
    propertiesEmitted: propNames,
    references,
    indexesEmitted: indexes.length,
    seams,
    notes,
  };

  return { typeItem, report };
}

// A reasonable primary display field: the first text-ish property named like a
// label, else the first string property.
function pickPrimaryField(table: SourceTable, propNames: string[]): string | undefined {
  const named = propNames.find((p) => /^(name|title|label|subject)$/i.test(p));
  if (named) return named;
  const firstString = table.columns.find((c: SourceColumn) => jsonSchemaForType(c.sqlType).type === 'string' && !/uuid/.test(c.sqlType.toLowerCase()));
  return firstString ? snakeToCamel(firstString.name) : undefined;
}
