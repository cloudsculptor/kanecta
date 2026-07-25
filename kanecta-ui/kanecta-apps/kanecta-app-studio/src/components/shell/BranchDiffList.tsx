import type { DiffDetail, DiffItemSnapshot } from '../../api/workingSets';
import './BranchDiffList.scss';

interface BranchDiffListProps {
  /** Item-level review payload from `/diff` or `/merge-preview`. */
  detail: DiffDetail;
}

const shortId = (id: string) => id.slice(0, 8);

// Bookkeeping fields every write touches — comparing them tells a reviewer
// nothing about WHAT changed, so they're excluded from the per-field diff.
// `icon` is a derived read-model field, never stored.
const BOOKKEEPING_FIELDS = new Set(['modifiedAt', 'modifiedBy', 'cachedAt', 'specVersion', 'icon']);

/** Human label for an item snapshot: its value if scalar, name/title if object. */
export function snapshotLabel(snap: DiffItemSnapshot): string {
  const { value } = snap;
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const named = v.name ?? v.title ?? v.label;
    if (typeof named === 'string' && named.trim()) return named;
  }
  return snap.type ? `(${snap.type})` : '(untitled)';
}

/** Render a field value compactly; `undefined` means the field is absent. */
function fmt(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Fields that differ between two snapshots, bookkeeping excluded. */
export function changedFields(before: DiffItemSnapshot, after: DiffItemSnapshot): FieldChange[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (BOOKKEEPING_FIELDS.has(field)) continue;
    const b = before[field];
    const a = after[field];
    if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ field, before: b, after: a });
  }
  return changes.sort((x, y) => x.field.localeCompare(y.field));
}

// Fields worth showing for an add/delete (a snapshot has ~25 mostly-null
// metadata fields; a reviewer cares about the substance).
const SNAPSHOT_FIELDS = ['value', 'type', 'parentId', 'tags', 'aspect', 'status', 'visibility'];

function snapshotRows(snap: DiffItemSnapshot): FieldChange[] {
  return SNAPSHOT_FIELDS.filter((f) => {
    const v = snap[f];
    return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
  }).map((f) => ({ field: f, before: undefined, after: snap[f] }));
}

function FieldTable({ rows, kind }: { rows: FieldChange[]; kind: 'add' | 'edit' | 'delete' }) {
  if (rows.length === 0) {
    return <p className="BranchDiffList__meta-only">Only modification metadata changed.</p>;
  }
  return (
    <table className="BranchDiffList__fields">
      <tbody>
        {rows.map(({ field, before, after }) => (
          <tr key={field}>
            <th className="BranchDiffList__field-name" scope="row">
              {field}
            </th>
            {kind === 'edit' && (
              <>
                <td className="BranchDiffList__field-value BranchDiffList__field-value--before">
                  {fmt(before)}
                </td>
                <td className="BranchDiffList__field-arrow" aria-hidden>
                  →
                </td>
              </>
            )}
            <td
              className={`BranchDiffList__field-value ${
                kind === 'delete' ? 'BranchDiffList__field-value--before' : ''
              }`}
            >
              {fmt(kind === 'delete' ? before ?? after : after)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ChangeRowProps {
  kind: 'add' | 'edit' | 'delete';
  id: string;
  snap: DiffItemSnapshot;
  rows: FieldChange[];
}

const KIND_MARK = { add: '+', edit: '±', delete: '−' } as const;

function ChangeRow({ kind, id, snap, rows }: ChangeRowProps) {
  return (
    <details className={`BranchDiffList__change BranchDiffList__change--${kind}`}>
      <summary className="BranchDiffList__change-summary">
        <span className={`BranchDiffList__mark BranchDiffList__mark--${kind}`} aria-hidden>
          {KIND_MARK[kind]}
        </span>
        <span className="BranchDiffList__label">{snapshotLabel(snap)}</span>
        {snap.type ? <span className="BranchDiffList__type">{String(snap.type)}</span> : null}
        <code className="BranchDiffList__id">{shortId(id)}</code>
      </summary>
      <FieldTable rows={rows} kind={kind} />
    </details>
  );
}

/**
 * The reviewable "PR diff": every item a branch adds, edits, or deletes,
 * expandable to the field level (before → after for edits). Pure render of
 * the `detail` payload — fetching stays with the caller.
 */
export function BranchDiffList({ detail }: BranchDiffListProps) {
  const total = detail.adds.length + detail.edits.length + detail.deletes.length;
  if (total === 0) return null;
  return (
    <div className="BranchDiffList" data-testid="branch-diff-list">
      {detail.adds.map(({ id, after }) => (
        <ChangeRow key={id} kind="add" id={id} snap={after} rows={snapshotRows(after)} />
      ))}
      {detail.edits.map(({ id, before, after }) => (
        <ChangeRow key={id} kind="edit" id={id} snap={after} rows={changedFields(before, after)} />
      ))}
      {detail.deletes.map(({ id, before }) => (
        <ChangeRow key={id} kind="delete" id={id} snap={before} rows={snapshotRows(before)} />
      ))}
    </div>
  );
}
