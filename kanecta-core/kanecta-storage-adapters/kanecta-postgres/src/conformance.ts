// Four-table-law conformance (spec §cqrs-projections).
//
// A conformant Kanecta datastore contains ONLY these relations:
//   * items                 — the item spine (exactly one)
//   * item_history, activity — the append-only exempt logs
//   * obj_<typeId>           — the per-type projection of every type (incl. built-ins),
//                              plus scalar-array child tables obj_<typeId>_<field>
//   * perf_<name>            — rebuildable, performance-only derived structures
// Bootstrapping lives in the root item's payload (rootPayload) — there is NO
// schema_version table and NO bespoke per-type table. Anything else is a violation.
//
// This is the machine-checkable form of the law: run checkConformance over a live
// datastore's table list and any drift fails the build.

export type TableKind = 'items' | 'item_history' | 'activity' | 'obj' | 'perf' | 'violation';

// obj_<uuid-with-underscores>, optionally with a _<field> scalar-array child suffix.
const OBJ_RE = /^obj_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}(_[a-z0-9_]+)?$/;

/** Classify a table name against the four-table law. */
export function classifyTable(name: string): TableKind {
  if (name === 'items') return 'items';
  if (name === 'item_history') return 'item_history';
  if (name === 'activity') return 'activity';
  if (OBJ_RE.test(name)) return 'obj';
  if (name.startsWith('perf_')) return 'perf';
  return 'violation';
}

export interface ConformanceReport {
  conformant: boolean;
  /** Non-conforming table names, sorted — the modernisation backlog. */
  violations: string[];
  /** Count per legitimate kind. */
  counts: Record<TableKind, number>;
}

/** Check a datastore's table list against the four-table law. */
export function checkConformance(tables: string[]): ConformanceReport {
  const counts: Record<TableKind, number> = { items: 0, item_history: 0, activity: 0, obj: 0, perf: 0, violation: 0 };
  const violations: string[] = [];
  for (const t of tables) {
    const kind = classifyTable(t);
    counts[kind]++;
    if (kind === 'violation') violations.push(t);
  }
  violations.sort();
  return { conformant: violations.length === 0, violations, counts };
}
