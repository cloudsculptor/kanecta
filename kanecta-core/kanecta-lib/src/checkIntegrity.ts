'use strict';

//
// Datastore integrity check.
//
// Verifies a datastore's structural integrity against the Kanecta 1.4.0
// specification. Checks are defined as DATA (see `INTEGRITY_CHECKS` below) — one
// entry per spec invariant, each traceable to a `specRef`. To add a check, add
// an array entry; nothing else needs to change.
//
// Results are produced PROGRESSIVELY via `checkIntegrityStream` (an async
// generator) so callers — a CLI, an SSE endpoint, a Studio view — can tick each
// check off as it completes. `checkIntegrity` is a thin collect-all wrapper.
//
// The validator is imported via the specification package's *version-current*
// subpath (`@kanecta/specification/validator`), so it is NOT pinned to 1.4.0 —
// when the spec bumps, the exports map re-points and this code follows.
//
// This runs against the public `Datastore` handle (never adapter internals), so
// it works across the sync filesystem adapter and the async cloud adapter alike.
//

import {
  validateType, validateItem, validateMetadata, validateFunction,
} from '@kanecta/specification/validator';

import { ROOT_ID, TYPES_NODE, UUID_RE, VALID_CONFIDENCES } from '@kanecta/sqlite-fs';

// ─── Result model ─────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'skip';
export type Severity = 'error' | 'warn';

export interface Finding {
  severity: Severity;
  message: string;
  /** The item this finding is about, when applicable. */
  nodeId?: string;
  /** How to remediate. */
  fix?: string;
  [extra: string]: unknown;
}

/** Static description of a check — enough for a UI to render the row up front. */
export interface CheckDescriptor {
  id: string;
  title: string;
  group: string;
  /** Spec anchor / section this invariant comes from. */
  specRef: string;
}

/** Outcome of running one check. */
export interface CheckResult extends CheckDescriptor {
  status: CheckStatus;
  findings: Finding[];
  /** Number of error+warn findings (0 when the check passed). */
  count: number;
  /** Reason the check was skipped (only when status === 'skip'). */
  skipped?: string;
}

export interface IntegritySummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errorCount: number;
  warnCount: number;
  /** true when no check reported an error-severity finding. */
  ok: boolean;
}

/** Progressive events emitted by `checkIntegrityStream`. */
export type IntegrityEvent =
  | { type: 'manifest'; total: number; checks: CheckDescriptor[] }
  | { type: 'result'; index: number; result: CheckResult }
  | { type: 'done'; summary: IntegritySummary };

export interface IntegrityReport {
  checks: CheckResult[];
  summary: IntegritySummary;
}

export interface CheckIntegrityOptions {
  /** Restrict to these check ids (default: all). */
  checks?: string[];
  /** Restrict to these groups (default: all). */
  groups?: string[];
}

// ─── Check definition ─────────────────────────────────────────────────────────

/** Sentinel a check may return to declare itself not-applicable here. */
interface Skip { skip: string }
const skip = (reason: string): Skip => ({ skip: reason });
const isSkip = (v: unknown): v is Skip =>
  !!v && typeof v === 'object' && typeof (v as any).skip === 'string';

interface IntegrityCheckDef extends CheckDescriptor {
  run(ctx: IntegrityContext): Promise<Finding[] | Skip>;
}

interface IntegrityContext {
  ds: any;
  /** loadAll() — real object/primitive items (excludes type/alias/rel/annotation/history). */
  items: any[];
  /** listTypeDefs() — [{ id, value }] for every `type` item. */
  typeDefs: Array<{ id: string; value: string }>;
  aliases: Array<{ alias: string; targetId: string }>;
  relationships: Array<{ id: string; sourceId: string; targetId: string; type: string }>;
  /** Every known item id (items + type defs + well-known nodes), grown lazily by `has`. */
  idSet: Set<string>;
  /** Membership test — falls back to a live get() for metadata/alias/rel items. */
  has(id: string): Promise<boolean>;
  /** Cached readTypeJson. */
  getType(id: string): Promise<any>;
  storage: 'filesystem' | 'cloud' | 'unknown';
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const err = (message: string, nodeId?: string, fix?: string, extra: Record<string, unknown> = {}): Finding =>
  ({ severity: 'error', message, ...(nodeId ? { nodeId } : {}), ...(fix ? { fix } : {}), ...extra });
const warn = (message: string, nodeId?: string, fix?: string, extra: Record<string, unknown> = {}): Finding =>
  ({ severity: 'warn', message, ...(nodeId ? { nodeId } : {}), ...(fix ? { fix } : {}), ...extra });

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/**
 * Maximum length of an item's `value` per the spec (item.value ≤ 255 chars).
 * Exported so quality/stats surfaces count over-long values with the same
 * definition the `value-length` integrity check enforces — never reinvent it.
 */
export const VALUE_MAX_LENGTH = 255;

/** True when an item's value exceeds the spec maximum length. */
export const isValueOverLong = (item: { value?: unknown }): boolean =>
  typeof item.value === 'string' && item.value.length > VALUE_MAX_LENGTH;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const INLINE_LINK_RE = /\[\[\[?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]?\]\]/g;
const VISIBILITY = new Set(['private', 'organisation', 'public']);
const LAYERS = new Set(['system', 'core', 'app', 'user']);

async function safe<T>(fn: () => T | Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

/**
 * The id of a built-in/user type item by its name (its `value`). Built-in
 * structured types (reference, view, cell, grid, …) are seeded type items, so an
 * instance is an `object` whose `typeId` equals the type item's id. Returns
 * undefined when the type is not registered — the caller then reports nothing
 * (there can be no instances of an unregistered type).
 */
function typeIdByName(ctx: IntegrityContext, name: string): string | undefined {
  return ctx.typeDefs.find((t) => t.value === name)?.id;
}

/** All object instances of a named type (empty when the type is not registered). */
function objectsOfType(ctx: IntegrityContext, name: string): any[] {
  const typeId = typeIdByName(ctx, name);
  if (!typeId) return [];
  return ctx.items.filter((it) => it.type === 'object' && it.typeId === typeId);
}

// ─── The check catalogue (checks-as-data) ─────────────────────────────────────
//
// Grouped: structure → tree → identity → schema → references → metadata →
// storage. Each entry is one spec invariant. This is intentionally the ONLY
// place you edit to add coverage.
//

const CHECKS: IntegrityCheckDef[] = [
  // ── structure ──────────────────────────────────────────────────────────────
  {
    id: 'id-is-uuid', group: 'structure',
    title: 'Every item id is a valid UUID',
    specRef: 'specification.adoc §Constraints (item.id globally unique UUID v4)',
    async run(ctx) {
      return ctx.items
        .filter((it) => !isUuid(it.id))
        .map((it) => err(`item id "${it.id}" is not a valid UUID`, it.id,
          'reissue the item with a valid UUID v4'));
    },
  },
  {
    id: 'id-unique', group: 'structure',
    title: 'Item ids are globally unique',
    specRef: 'specification.adoc §Constraints (id globally unique)',
    async run(ctx) {
      const seen = new Map<string, number>();
      for (const it of ctx.items) seen.set(it.id, (seen.get(it.id) ?? 0) + 1);
      for (const t of ctx.typeDefs) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
      const findings: Finding[] = [];
      for (const [id, n] of seen) {
        if (n > 1) findings.push(err(`id "${id}" is used by ${n} items`, id, 'give each item a distinct UUID'));
      }
      return findings;
    },
  },
  {
    id: 'reserved-uuids', group: 'structure',
    title: 'Reserved UUIDs are not reused by user items',
    specRef: 'specification.adoc §Well-Known Root Node (00000000… and 11111111… are reserved)',
    async run(ctx) {
      return ctx.items
        .filter((it) => (it.id === ROOT_ID && it.type !== 'root') || (it.id === TYPES_NODE && it.type !== 'types'))
        .map((it) => err(`item ${it.id} reuses a reserved well-known UUID with type "${it.type}"`, it.id,
          'reissue this item with a fresh UUID'));
    },
  },
  {
    id: 'root-singleton', group: 'structure',
    title: 'Exactly one root node (all-zeros UUID, self-parented)',
    specRef: 'specification.adoc §Well-Known Root Node',
    async run(ctx) {
      const findings: Finding[] = [];
      const root = await safe(() => ctx.ds.get(ROOT_ID), null);
      if (!root) findings.push(err(`no root node found at ${ROOT_ID}`, ROOT_ID, 'a datastore must have exactly one root'));
      else if (root.parentId !== ROOT_ID) {
        findings.push(err(`root node parentId is "${root.parentId}", expected self-reference ${ROOT_ID}`, ROOT_ID));
      }
      const selfParented = ctx.items.filter((it) => it.id === it.parentId && it.id !== ROOT_ID);
      for (const it of selfParented) {
        findings.push(err(`item ${it.id} is self-parented but is not the root`, it.id,
          'only the root may reference itself as parent'));
      }
      return findings;
    },
  },
  {
    id: 'types-node-present', group: 'structure',
    title: 'The well-known types node exists under root',
    specRef: 'specification.adoc §Well-Known Root Node (types node 11111111…)',
    async run(ctx) {
      const node = await safe(() => ctx.ds.get(TYPES_NODE), null);
      if (!node) return [err(`no types node found at ${TYPES_NODE}`, TYPES_NODE, 'seed the well-known types node')];
      const findings: Finding[] = [];
      if (node.type !== 'types') findings.push(err(`types node has type "${node.type}", expected "types"`, TYPES_NODE));
      if (node.parentId !== ROOT_ID) findings.push(err(`types node parentId is "${node.parentId}", expected ${ROOT_ID}`, TYPES_NODE));
      return findings;
    },
  },

  // ── tree ─────────────────────────────────────────────────────────────────────
  {
    id: 'parentid-present', group: 'tree',
    title: 'Every item has a parentId',
    specRef: 'specification.adoc §parentId rules (non-null, no exceptions)',
    async run(ctx) {
      return ctx.items
        .filter((it) => it.parentId == null || it.parentId === '')
        .map((it) => err(`item ${it.id} has no parentId`, it.id, 'set a parentId (root children point at the root)'));
    },
  },
  {
    id: 'parentid-resolves', group: 'tree',
    title: 'Every parentId resolves to an existing item',
    specRef: 'specification.adoc §parentId rules (FK to items(id))',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (it.parentId == null || it.id === ROOT_ID) continue;
        if (!(await ctx.has(it.parentId))) {
          findings.push(err(`item ${it.id} has parentId ${it.parentId}, which does not exist`, it.id,
            're-parent the item or restore the missing parent', { parentId: it.parentId }));
        }
      }
      return findings;
    },
  },
  {
    id: 'no-parentid-cycles', group: 'tree',
    title: 'No parentId cycles (except the root self-reference)',
    specRef: 'specification.adoc §parentId rules (no circular chains)',
    async run(ctx) {
      const parentOf = new Map<string, string>();
      for (const it of ctx.items) if (it.parentId != null) parentOf.set(it.id, it.parentId);
      const findings: Finding[] = [];
      for (const start of parentOf.keys()) {
        const seen = new Set<string>([start]);
        let cur = parentOf.get(start);
        while (cur != null && cur !== ROOT_ID) {
          if (cur === start || seen.has(cur)) {
            findings.push(err(`item ${start} is part of a parentId cycle`, start, 'break the cycle by re-parenting one item'));
            break;
          }
          seen.add(cur);
          const next = parentOf.get(cur);
          if (next === undefined) break; // parent outside the item set — covered by parentid-resolves
          cur = next;
        }
      }
      return findings;
    },
  },
  {
    id: 'object-parent-equals-typeid', group: 'tree',
    title: 'Object instances are parented under their type item',
    specRef: 'specification.adoc §Item Placement (user objects → parentId = typeId)',
    async run(ctx) {
      return ctx.items
        .filter((it) => it.type === 'object' && it.typeId && it.parentId !== it.typeId)
        .map((it) => warn(
          `object ${it.id} has parentId ${it.parentId} but typeId ${it.typeId} — instances should be parented under their type item`,
          it.id, 'set parentId to the typeId', { typeId: it.typeId, parentId: it.parentId }));
    },
  },
  {
    id: 'type-items-under-types-node', group: 'tree',
    title: 'Every type item is parented under the types node',
    specRef: 'specification.adoc §Synthetic type items (type.parentId = 11111111…)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.typeDefs) {
        const item = await safe(() => ctx.ds.get(t.id), null);
        if (item && item.parentId !== TYPES_NODE) {
          findings.push(err(`type item ${t.id} ("${t.value}") has parentId ${item.parentId}, expected ${TYPES_NODE}`,
            t.id, 're-parent the type item under the types node'));
        }
      }
      return findings;
    },
  },

  // ── identity / typing ────────────────────────────────────────────────────────
  {
    id: 'object-has-typeid', group: 'identity',
    title: 'Objects have a typeId; non-objects do not',
    specRef: 'specification.adoc §item section (typeId set when type=object, null otherwise)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (it.type === 'object' && !it.typeId) {
          findings.push(err(`object ${it.id} has no typeId`, it.id, 'set typeId to the object’s type item'));
        } else if (it.type !== 'object' && it.typeId) {
          findings.push(err(`item ${it.id} of type "${it.type}" has a typeId (${it.typeId}) — only objects may`, it.id,
            'clear typeId on non-object items'));
        }
      }
      return findings;
    },
  },
  {
    id: 'typeid-resolves', group: 'identity',
    title: 'Every object typeId resolves to a type item',
    specRef: 'specification.adoc §item section (typeId → existing type item)',
    async run(ctx) {
      const typeIds = new Set(ctx.typeDefs.map((t) => t.id));
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (it.type !== 'object' || !it.typeId) continue;
        if (!typeIds.has(it.typeId)) {
          const target = await safe(() => ctx.ds.get(it.typeId), null);
          if (!target || target.type !== 'type') {
            findings.push(err(`object ${it.id} references typeId ${it.typeId}, which has no type definition`, it.id,
              'register the missing type definition, or remove/retype the item', { typeId: it.typeId }));
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'value-length', group: 'identity',
    title: `Item value is at most ${VALUE_MAX_LENGTH} characters`,
    specRef: 'specification.adoc §item section (value ≤ 255 chars)',
    async run(ctx) {
      return ctx.items
        .filter(isValueOverLong)
        .map((it) => err(`item ${it.id} value is ${it.value.length} chars (max ${VALUE_MAX_LENGTH})`, it.id,
          'shorten value; move long text into a text/markdown child or payload field'));
    },
  },

  // ── schema validation (version-current validator) ────────────────────────────
  {
    id: 'metadata-valid', group: 'schema',
    title: 'Item metadata validates against the spec',
    specRef: 'kanecta-schema-validator: validateMetadata',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (it.id === ROOT_ID || it.id === TYPES_NODE) continue; // well-known nodes have a bespoke shape
        const meta = {
          id: it.id, parentId: it.parentId, value: it.value, type: it.type, typeId: it.typeId ?? undefined,
          owner: it.owner, license: it.license, createdAt: it.createdAt, modifiedAt: it.modifiedAt,
          visibility: it.visibility, tags: it.tags,
          completedAt: it.completedAt, dueAt: it.dueAt, cachedAt: it.cachedAt,
        };
        const res = validateMetadata(meta);
        for (const e of res.errors) {
          findings.push(err(`metadata.${e.path || '(root)'}: ${e.message}`, it.id, undefined, { rule: e.rule }));
        }
      }
      return findings;
    },
  },
  {
    id: 'typedef-valid', group: 'schema',
    title: 'User type definitions are well-formed (jsonSchema + sqlSchema)',
    specRef: 'specification.adoc §jsonSchema rules; validator: validateType',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.typeDefs) {
        // Only user-authored types are held to the strict validateType rules.
        // Built-in/system types (layer system/core) ship their schemas from the
        // spec package and are validated at spec-build time, not at rest.
        const item = await safe(() => ctx.ds.get(t.id), null);
        if (item && (item.layer === 'system' || item.layer === 'core')) continue;
        const typeJson = await ctx.getType(t.id);
        if (!typeJson) continue; // no payload schema to validate
        const res = validateType(typeJson);
        for (const e of res.errors) {
          findings.push(err(`type "${t.value}" ${e.path || '(root)'}: ${e.message}`, t.id, undefined, { rule: e.rule }));
        }
      }
      return findings;
    },
  },
  {
    id: 'object-payload-valid', group: 'schema',
    title: 'Object payloads validate against their type jsonSchema',
    specRef: 'specification.adoc §payload section; validator: validateItem',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (it.type !== 'object' || !it.typeId) continue;
        const typeJson = await ctx.getType(it.typeId);
        if (!typeJson || typeof typeJson.jsonSchema !== 'object') continue; // no schema to validate against
        const payload = await safe(() => ctx.ds.readObjectJson(it.id), null);
        if (payload == null) continue; // empty payload is not an integrity error here
        const res = validateItem(payload, typeJson);
        for (const e of res.errors) {
          findings.push(err(`object ${it.id} payload.${e.path || '(root)'}: ${e.message}`, it.id,
            'correct the payload to match the type schema', { rule: e.rule }));
        }
      }
      return findings;
    },
  },
  {
    id: 'function-payload-valid', group: 'schema',
    title: 'Function definitions are well-formed',
    specRef: 'specification.adoc §function type; validator: validateFunction',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (it.type !== 'function') continue;
        const payload = await safe(() => ctx.ds.readFunctionJson(it.id), null);
        if (payload == null) continue;
        const res = validateFunction(payload);
        for (const e of res.errors) {
          findings.push(err(`function ${it.id} ${e.path || '(root)'}: ${e.message}`, it.id, undefined, { rule: e.rule }));
        }
      }
      return findings;
    },
  },

  // ── references & links ───────────────────────────────────────────────────────
  {
    id: 'alias-targets-resolve', group: 'references',
    title: 'Every alias points at an existing item',
    specRef: 'specification.adoc §aliasPayload (targetId resolves)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const a of ctx.aliases) {
        if (!(await ctx.has(a.targetId))) {
          findings.push(err(`alias "${a.alias}" points at ${a.targetId}, which does not exist`, a.targetId,
            'remove the dangling alias or restore the target', { alias: a.alias }));
        }
      }
      return findings;
    },
  },
  {
    id: 'alias-uniqueness', group: 'references',
    title: 'Alias strings are unique (case-insensitive)',
    specRef: 'specification.adoc §aliasPayload (alias uniqueness per scope)',
    async run(ctx) {
      const seen = new Map<string, number>();
      for (const a of ctx.aliases) {
        const key = a.alias.toLowerCase();
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      const findings: Finding[] = [];
      for (const [key, n] of seen) {
        if (n > 1) findings.push(err(`alias "${key}" is defined ${n} times`, undefined, 'keep one alias per name'));
      }
      return findings;
    },
  },
  {
    id: 'relationship-endpoints-resolve', group: 'references',
    title: 'Relationship endpoints resolve to existing items',
    specRef: 'specification.adoc §relationshipPayload (sourceId/targetId resolve)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const r of ctx.relationships) {
        for (const [role, id] of [['source', r.sourceId], ['target', r.targetId]] as const) {
          if (id && !(await ctx.has(id))) {
            findings.push(err(`relationship ${r.id} ${role} ${id} does not exist`, r.id,
              'remove the relationship or restore the endpoint', { role, endpoint: id, relType: r.type }));
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'inline-links-resolve', group: 'references',
    title: 'Inline [[uuid]] links resolve to existing items',
    specRef: 'specification.adoc §Inline Links',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (typeof it.value !== 'string' || !it.value.includes('[[')) continue;
        INLINE_LINK_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        const targets = new Set<string>();
        while ((m = INLINE_LINK_RE.exec(it.value)) !== null) targets.add(m[1].toLowerCase());
        for (const target of targets) {
          if (!(await ctx.has(target))) {
            findings.push(warn(`item ${it.id} links to [[${target}]], which does not exist`, it.id,
              'fix or remove the broken inline link', { target }));
          }
        }
      }
      return findings;
    },
  },

  // ── metadata enums / uniqueness ──────────────────────────────────────────────
  {
    id: 'visibility-enum', group: 'metadata',
    title: 'Visibility is private, organisation, or public',
    specRef: 'specification.adoc §meta.visibility',
    async run(ctx) {
      return ctx.items
        .filter((it) => it.visibility != null && !VISIBILITY.has(it.visibility))
        .map((it) => err(`item ${it.id} has visibility "${it.visibility}"`, it.id,
          `set visibility to one of: ${[...VISIBILITY].join(', ')}`));
    },
  },
  {
    id: 'confidence-enum', group: 'metadata',
    title: 'Confidence is a recognised value',
    specRef: 'specification.adoc §Confidence and Status',
    async run(ctx) {
      const valid = new Set(VALID_CONFIDENCES);
      return ctx.items
        .filter((it) => it.confidence != null && !valid.has(it.confidence))
        .map((it) => warn(`item ${it.id} has confidence "${it.confidence}"`, it.id,
          `set confidence to one of: ${[...valid].join(', ')} (or null)`));
    },
  },
  {
    id: 'layer-enum', group: 'metadata',
    title: 'Layer is system, core, app, user, or null',
    specRef: 'specification.adoc §meta.layer',
    async run(ctx) {
      return ctx.items
        .filter((it) => it.layer != null && !LAYERS.has(it.layer))
        .map((it) => err(`item ${it.id} has layer "${it.layer}"`, it.id,
          `set layer to one of: ${[...LAYERS].join(', ')} (or null)`));
    },
  },
  {
    id: 'source-external-id-unique', group: 'metadata',
    title: 'Source (system, externalId) is unique',
    specRef: 'specification.adoc §meta.sourceExternalId (unique per workspace)',
    async run(ctx) {
      const seen = new Map<string, string[]>();
      for (const it of ctx.items) {
        if (!it.sourceSystem || !it.sourceExternalId) continue;
        const key = `${it.sourceSystem} ${it.sourceExternalId}`;
        (seen.get(key) ?? seen.set(key, []).get(key)!).push(it.id);
      }
      const findings: Finding[] = [];
      for (const [key, ids] of seen) {
        if (ids.length > 1) {
          const [system, ext] = key.split(' ');
          findings.push(err(`source (${system}, ${ext}) is used by ${ids.length} items: ${ids.join(', ')}`,
            ids[0], 'deduplicate: ingestion must upsert on (sourceSystem, sourceExternalId)'));
        }
      }
      return findings;
    },
  },
  {
    id: 'timestamps-valid', group: 'metadata',
    title: 'createdAt / modifiedAt are ISO-8601',
    specRef: 'specification.adoc §meta timestamps',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        for (const field of ['createdAt', 'modifiedAt'] as const) {
          const v = it[field];
          if (v != null && !(typeof v === 'string' && ISO_RE.test(v))) {
            findings.push(err(`item ${it.id} ${field} "${v}" is not an ISO-8601 datetime`, it.id));
          }
        }
      }
      return findings;
    },
  },

  // ── references & links (continued) ───────────────────────────────────────────
  {
    id: 'symlink-target-resolves', group: 'references',
    title: 'Every symlink resolves to an existing item',
    specRef: 'specification.adoc §Trees and Collections (symlink item.value is the target UUID)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (it.type !== 'symlink') continue;
        if (!isUuid(it.value)) {
          findings.push(err(`symlink ${it.id} value "${it.value}" is not a target UUID`, it.id,
            'a symlink item.value must be the UUID of the target item'));
          continue;
        }
        if (!(await ctx.has(it.value))) {
          findings.push(err(`symlink ${it.id} points at ${it.value}, which does not exist`, it.id,
            'repoint or remove the dangling symlink', { target: it.value }));
        }
      }
      return findings;
    },
  },
  {
    id: 'connectorid-resolves', group: 'references',
    title: 'Every meta.connectorId resolves to an existing item',
    specRef: 'specification.adoc §meta.connectorId (UUID of the managing connector)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        if (it.connectorId == null) continue;
        if (!(await ctx.has(it.connectorId))) {
          findings.push(err(`item ${it.id} has connectorId ${it.connectorId}, which does not exist`, it.id,
            'clear meta.connectorId or restore the missing connector', { connectorId: it.connectorId }));
        }
      }
      return findings;
    },
  },

  // ── metadata (continued) ─────────────────────────────────────────────────────
  {
    id: 'materialized-stub-consistency', group: 'metadata',
    title: 'Unmaterialized stubs carry a connectorId',
    specRef: 'specification.adoc §meta.materialized (stub ⇒ connectorId set; partial index WHERE materialized=false AND connector_id IS NOT NULL)',
    async run(ctx) {
      return ctx.items
        .filter((it) => it.materialized === false && it.connectorId == null)
        .map((it) => err(`item ${it.id} is an unmaterialized stub (materialized=false) but has no connectorId`, it.id,
          'a stub must reference the connector that will materialize it, or be marked materialized'));
    },
  },

  // ── type-definition well-formedness (continued) — user types only ─────────────
  {
    id: 'typedef-defaultenforce-valid', group: 'schema',
    title: 'Type constraints.defaultEnforce is reject, warn, or none',
    specRef: 'specification.adoc §constraints.defaultEnforce (L1755)',
    async run(ctx) {
      const allowed = new Set(['reject', 'warn', 'none']);
      const findings: Finding[] = [];
      for (const t of ctx.typeDefs) {
        const item = await safe(() => ctx.ds.get(t.id), null);
        if (item && (item.layer === 'system' || item.layer === 'core')) continue;
        const typeJson = await ctx.getType(t.id);
        const de = typeJson?.constraints?.defaultEnforce;
        if (de !== undefined && !allowed.has(de)) {
          findings.push(err(`type "${t.value}" constraints.defaultEnforce is "${de}"`, t.id,
            'set defaultEnforce to one of: reject, warn, none'));
        }
      }
      return findings;
    },
  },
  {
    id: 'typedef-children-well-formed', group: 'schema',
    title: 'Type constraints.children entries use a valid semantics (and enforce)',
    specRef: 'specification.adoc §constraints.children (semantics ∈ single|optional|list|set|map; L1703–1755)',
    async run(ctx) {
      const semantics = new Set(['single', 'optional', 'list', 'set', 'map']);
      const enforce = new Set(['reject', 'warn', 'none']);
      const findings: Finding[] = [];
      for (const t of ctx.typeDefs) {
        const item = await safe(() => ctx.ds.get(t.id), null);
        if (item && (item.layer === 'system' || item.layer === 'core')) continue;
        const typeJson = await ctx.getType(t.id);
        const children = typeJson?.constraints?.children;
        if (!Array.isArray(children)) continue;
        children.forEach((c: any, i: number) => {
          if (c?.semantics !== undefined && !semantics.has(c.semantics)) {
            findings.push(err(`type "${t.value}" constraints.children[${i}].semantics is "${c.semantics}"`, t.id,
              `set semantics to one of: ${[...semantics].join(', ')}`));
          }
          if (c?.enforce !== undefined && !enforce.has(c.enforce)) {
            findings.push(err(`type "${t.value}" constraints.children[${i}].enforce is "${c.enforce}"`, t.id,
              `set enforce to one of: ${[...enforce].join(', ')}`));
          }
        });
      }
      return findings;
    },
  },
  {
    id: 'typedef-ref-keywords-exclusive', group: 'schema',
    title: 'A schema property cannot carry both typeId and x-kanecta-itemType',
    specRef: 'specification.adoc §Reference-enforcement keywords (typeId vs x-kanecta-itemType, L1635–1648)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.typeDefs) {
        const item = await safe(() => ctx.ds.get(t.id), null);
        if (item && (item.layer === 'system' || item.layer === 'core')) continue;
        const typeJson = await ctx.getType(t.id);
        const props = typeJson?.jsonSchema?.properties;
        if (!props || typeof props !== 'object') continue;
        for (const [name, def] of Object.entries(props as Record<string, any>)) {
          if (def && def.typeId !== undefined && def['x-kanecta-itemType'] !== undefined) {
            findings.push(err(`type "${t.value}" property "${name}" carries both typeId and x-kanecta-itemType`, t.id,
              'a UUID-reference property may declare only one target-type keyword'));
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'nullable-timestamps-valid', group: 'metadata',
    title: 'Optional timestamps (deletedAt, cachedAt, expiresAt, completedAt, dueAt) are ISO-8601 or null',
    specRef: 'specification.adoc §meta timestamps (L365–408); the time-related nullable meta fields',
    async run(ctx) {
      const fields = ['deletedAt', 'cachedAt', 'expiresAt', 'completedAt', 'dueAt'] as const;
      const findings: Finding[] = [];
      for (const it of ctx.items) {
        for (const field of fields) {
          const v = it[field];
          if (v != null && !(typeof v === 'string' && ISO_RE.test(v))) {
            findings.push(err(`item ${it.id} ${field} "${v}" is not an ISO-8601 datetime`, it.id,
              `set ${field} to an ISO-8601 datetime or null`));
          }
        }
      }
      return findings;
    },
  },

  // ── built-in reference-type resolution (payload targets) ─────────────────────
  {
    id: 'reference-target-resolves', group: 'references',
    title: 'Every reference object points at an existing item',
    specRef: 'specification.adoc §referencePayload (targetId resolves, L2189)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of objectsOfType(ctx, 'reference')) {
        const payload = await safe(() => ctx.ds.readObjectJson(it.id), null);
        const target = payload?.targetId;
        if (target == null) continue;
        if (!(await ctx.has(target))) {
          findings.push(err(`reference ${it.id} targets ${target}, which does not exist`, it.id,
            'remove the dangling reference or restore the target', { targetId: target }));
        }
      }
      return findings;
    },
  },
  {
    id: 'subscription-target-resolves', group: 'references',
    title: 'Every subscription object points at an existing item',
    specRef: 'specification.adoc §subscriptionPayload (targetId resolves, L2254)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of objectsOfType(ctx, 'subscription')) {
        const payload = await safe(() => ctx.ds.readObjectJson(it.id), null);
        const target = payload?.targetId;
        if (target == null) continue;
        if (!(await ctx.has(target))) {
          findings.push(err(`subscription ${it.id} targets ${target}, which does not exist`, it.id,
            'remove the dangling subscription or restore the target', { targetId: target }));
        }
      }
      return findings;
    },
  },
  {
    id: 'view-refs-resolve', group: 'references',
    title: 'View objects reference existing item, component, and context',
    specRef: 'specification.adoc §viewPayload (itemId/componentId/contextId resolve, L2037–2047)',
    async run(ctx) {
      const findings: Finding[] = [];
      for (const it of objectsOfType(ctx, 'view')) {
        const payload = await safe(() => ctx.ds.readObjectJson(it.id), null);
        if (!payload) continue;
        for (const field of ['itemId', 'componentId', 'contextId'] as const) {
          const ref = payload[field];
          if (ref == null) continue;
          if (!(await ctx.has(ref))) {
            findings.push(err(`view ${it.id} ${field} ${ref} does not exist`, it.id,
              'repoint or clear the dangling view reference', { field, ref }));
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'cell-parent-is-grid', group: 'tree',
    title: 'Every grid cell is parented under a grid',
    specRef: 'specification.adoc §cellPayload NOTE (cell.parentId → a grid item, L2839)',
    async run(ctx) {
      const gridTypeId = typeIdByName(ctx, 'grid');
      const byId = new Map(ctx.items.map((it) => [it.id, it]));
      const findings: Finding[] = [];
      for (const it of objectsOfType(ctx, 'cell')) {
        const parent = byId.get(it.parentId) ?? await safe(() => ctx.ds.get(it.parentId), null);
        const parentIsGrid = !!parent && parent.type === 'object' && parent.typeId === gridTypeId;
        if (!parentIsGrid) {
          findings.push(err(`cell ${it.id} is parented under ${it.parentId}, which is not a grid`, it.id,
            'parent grid cells under a grid item', { parentId: it.parentId }));
        }
      }
      return findings;
    },
  },

  // ── storage-specific (Postgres) — recorded here, skipped on filesystem ────────
  {
    id: 'obj-table-matches-sqlschema', group: 'storage',
    title: 'Postgres obj_<typeId> tables match the derived sqlSchema',
    specRef: 'specification.adoc §sqlSchema rules (Postgres projection)',
    async run(ctx) {
      if (ctx.storage !== 'cloud') return skip('only applies to the Postgres (cloud) adapter');
      // Introspecting live DDL requires adapter-internal access not on the public
      // handle; deferred until the Postgres adapter exposes schema introspection.
      return skip('Postgres schema introspection not yet exposed on the datastore handle');
    },
  },
];

// ─── Engine ───────────────────────────────────────────────────────────────────

/** The full, static catalogue — render this up front to show every row. */
export const INTEGRITY_CHECKS: CheckDescriptor[] = CHECKS.map(descriptor);

function descriptor(c: CheckDescriptor): CheckDescriptor {
  return { id: c.id, title: c.title, group: c.group, specRef: c.specRef };
}

function selectChecks(opts: CheckIntegrityOptions): IntegrityCheckDef[] {
  let defs = CHECKS;
  if (opts.checks?.length) {
    const want = new Set(opts.checks);
    defs = defs.filter((c) => want.has(c.id));
  }
  if (opts.groups?.length) {
    const want = new Set(opts.groups);
    defs = defs.filter((c) => want.has(c.group));
  }
  return defs;
}

async function buildContext(ds: any): Promise<IntegrityContext> {
  const items = await safe(() => ds.loadAll(), [] as any[]);
  const typeDefs = await safe(() => ds.listTypeDefs(), [] as Array<{ id: string; value: string }>);
  const aliases = await safe(() => ds.listAliases(), [] as Array<{ alias: string; targetId: string }>);
  const relationships = await safe(() => ds.listRelationships(), [] as any[]);

  const idSet = new Set<string>([ROOT_ID, TYPES_NODE]);
  for (const it of items) idSet.add(it.id);
  for (const t of typeDefs) idSet.add(t.id);

  const typeCache = new Map<string, any>();
  const getType = async (id: string) => {
    if (!typeCache.has(id)) typeCache.set(id, await safe(() => ds.readTypeJson(id), null));
    return typeCache.get(id);
  };

  const missCache = new Set<string>();
  const has = async (id: string) => {
    if (idSet.has(id)) return true;
    if (missCache.has(id)) return false;
    const item = await safe(() => ds.get(id), null);
    if (item) { idSet.add(id); return true; }
    missCache.add(id);
    return false;
  };

  let storage: IntegrityContext['storage'] = 'unknown';
  try { if (ds.root) storage = 'filesystem'; } catch { /* cloud adapter has no root */ }

  return { ds, items, typeDefs, aliases, relationships, idSet, has, getType, storage };
}

async function runOne(def: IntegrityCheckDef, ctx: IntegrityContext): Promise<CheckResult> {
  const base = descriptor(def);
  let outcome: Finding[] | Skip;
  try {
    outcome = await def.run(ctx);
  } catch (e: any) {
    return { ...base, status: 'fail', count: 1,
      findings: [err(`check errored: ${e?.message ?? e}`, undefined, 'this is a bug in the check itself')] };
  }
  if (isSkip(outcome)) {
    return { ...base, status: 'skip', count: 0, findings: [], skipped: outcome.skip };
  }
  const findings = outcome ?? [];
  const hasError = findings.some((f) => f.severity === 'error');
  return { ...base, status: hasError ? 'fail' : 'pass', count: findings.length, findings };
}

function summarize(results: CheckResult[]): IntegritySummary {
  let passed = 0, failed = 0, skipped = 0, errorCount = 0, warnCount = 0;
  for (const r of results) {
    if (r.status === 'pass') passed++;
    else if (r.status === 'fail') failed++;
    else skipped++;
    for (const f of r.findings) f.severity === 'error' ? errorCount++ : warnCount++;
  }
  return { total: results.length, passed, failed, skipped, errorCount, warnCount, ok: errorCount === 0 };
}

/**
 * Run the integrity check, yielding progressively:
 *  1. one `manifest` event listing every check (render the checklist up front),
 *  2. one `result` event per check as it completes (flip the tick),
 *  3. a final `done` event with the summary.
 */
export async function* checkIntegrityStream(ds: any, opts: CheckIntegrityOptions = {}): AsyncGenerator<IntegrityEvent> {
  const defs = selectChecks(opts);
  const ctx = await buildContext(ds);

  yield { type: 'manifest', total: defs.length, checks: defs.map(descriptor) };

  const results: CheckResult[] = [];
  let index = 0;
  for (const def of defs) {
    const result = await runOne(def, ctx);
    results.push(result);
    yield { type: 'result', index: index++, result };
  }

  yield { type: 'done', summary: summarize(results) };
}

/** Run the integrity check and collect the full report (non-streaming). */
export async function checkIntegrity(ds: any, opts: CheckIntegrityOptions = {}): Promise<IntegrityReport> {
  const checks: CheckResult[] = [];
  let summary: IntegritySummary | undefined;
  for await (const ev of checkIntegrityStream(ds, opts)) {
    if (ev.type === 'result') checks.push(ev.result);
    else if (ev.type === 'done') summary = ev.summary;
  }
  return { checks, summary: summary ?? summarize(checks) };
}
