// Four-table-law conformance for the SQLite index (spec §cqrs-projections).
// Ported from @kanecta/postgres src/conformance.ts — the law "applies to every
// SQL adapter equally — Postgres AND SQLite" (spec §the-four-table-law).
//
// A conformant index.db contains ONLY these relations:
//   * items (+ its 1:1 envelope sections items_meta / items_search / items_time
//     and the write-side items_payload) — the spec says the physical
//     decomposition of the spine into sections is "not a fifth kind"
//   * item_history, activity  — the append-only exempt logs
//   * obj_<typeId>            — the per-type projection of every type,
//                               plus scalar-array child tables obj_<typeId>_<field>
//   * perf_<name>             — rebuildable, performance-only derived structures
//   * sqlite_*                — SQLite's own internals (sqlite_sequence etc.)
//
// There is NO branches/branch_changes kind here: on the filesystem adapter a
// branch is a self-contained FOLDER (branches/<name>/ with its own index.db),
// so branch registry state never appears as a table. Anything else — bespoke
// `history`/`backlinks`/`item_tags`/`type_defs` era tables — is a violation.
//
// This is the machine-checkable form of the law: run checkConformance over a
// live index.db's table list and any drift fails the build.

export type TableKind = 'items' | 'item_history' | 'activity' | 'obj' | 'perf' | 'sqlite' | 'violation';

// The item spine and its sanctioned physical sections (spec: envelope sections
// decomposed 1:1 off `items` are not a fifth kind; items_payload is the
// write-side payload store, never a read surface).
const SPINE = new Set(['items', 'items_meta', 'items_search', 'items_time', 'items_payload']);

// obj_<uuid-with-underscores>, optionally with a _<field> scalar-array child suffix.
const OBJ_RE = /^obj_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}(_[a-z0-9_]+)?$/;

/** Classify a table name against the four-table law. */
export function classifyTable(name: string): TableKind {
  if (SPINE.has(name)) return 'items';
  if (name === 'item_history') return 'item_history';
  if (name === 'activity') return 'activity';
  if (OBJ_RE.test(name)) return 'obj';
  if (name.startsWith('perf_')) return 'perf';
  if (name.startsWith('sqlite_')) return 'sqlite'; // SQLite internals (e.g. sqlite_sequence)
  return 'violation';
}

export interface ConformanceReport {
  conformant: boolean;
  /** Non-conforming table names, sorted — the modernisation backlog. */
  violations: string[];
  /** Count per legitimate kind. */
  counts: Record<TableKind, number>;
}

/** Check an index.db's table list against the four-table law. */
export function checkConformance(tables: string[]): ConformanceReport {
  const counts: Record<TableKind, number> = { items: 0, item_history: 0, activity: 0, obj: 0, perf: 0, sqlite: 0, violation: 0 };
  const violations: string[] = [];
  for (const t of tables) {
    const kind = classifyTable(t);
    counts[kind]++;
    if (kind === 'violation') violations.push(t);
  }
  violations.sort();
  return { conformant: violations.length === 0, violations, counts };
}
