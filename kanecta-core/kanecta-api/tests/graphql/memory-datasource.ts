// An in-memory DataSource for exercising the generic executor without a database.
// Rows are keyed by type name and store snake_case columns (as the obj_<type>
// tables would). Relationships and computed functions are supplied as data, so a
// test can assemble a small discussions graph and resolve queries against it.

import type { DataSource, StoredRow, ExecContext } from '../../src/graphql/execute.ts';
import type { SelectArgs } from '../../src/graphql/sql-query.ts';

interface Rel { sourceId: string; targetId: string; type: string }

type ComputedFn = (row: StoredRow, viewer: string | undefined, db: MemoryDataSource) => unknown;

export class MemoryDataSource implements DataSource {
  private rows = new Map<string, StoredRow[]>();
  private typeOfRow = new Map<string, string>(); // id → typeName
  private rels: Rel[] = [];
  private computed = new Map<string, ComputedFn>();

  addRow(typeName: string, row: StoredRow): this {
    if (!this.rows.has(typeName)) this.rows.set(typeName, []);
    this.rows.get(typeName)!.push(row);
    this.typeOfRow.set(row.id, typeName);
    return this;
  }

  addRelationship(sourceId: string, targetId: string, type: string): this {
    this.rels.push({ sourceId, targetId, type });
    return this;
  }

  addComputed(fnId: string, fn: ComputedFn): this {
    this.computed.set(fnId, fn);
    return this;
  }

  rowsOf(typeName: string): StoredRow[] {
    return this.rows.get(typeName) ?? [];
  }

  getById(typeName: string, id: string): StoredRow | null {
    return this.rowsOf(typeName).find((r) => r.id === id) ?? null;
  }

  query(typeName: string, args: SelectArgs): StoredRow[] {
    let rows = [...this.rowsOf(typeName)];
    // Minimal sort support (single scalar field, by wire→column already snake).
    if (args.sort?.length) {
      const [s] = args.sort;
      rows.sort((a, b) => {
        const av = a.columns[snake(s.field)] as any;
        const bv = b.columns[snake(s.field)] as any;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return s.direction === 'DESC' ? -cmp : cmp;
      });
    }
    const offset = args.offset ?? 0;
    const limit = args.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  children(parentId: string, targetTypeName: string): StoredRow[] {
    return this.rowsOf(targetTypeName).filter((r) => r.parentId === parentId);
  }

  related(id: string, relationshipType: string | undefined, direction: 'outgoing' | 'incoming', targetTypeName: string): StoredRow[] {
    const matches = this.rels.filter(
      (r) => r.type === relationshipType && (direction === 'outgoing' ? r.sourceId === id : r.targetId === id),
    );
    const ids = matches.map((r) => (direction === 'outgoing' ? r.targetId : r.sourceId));
    return ids
      .map((tid) => this.getById(targetTypeName, tid))
      .filter((r): r is StoredRow => r != null);
  }

  runComputed(backedBy: string, _scope: 'shared' | 'perViewer', args: { row: StoredRow; ctx: ExecContext }): unknown {
    const fn = this.computed.get(backedBy);
    if (!fn) throw new Error(`No computed fn registered for ${backedBy}`);
    return fn(args.row, args.ctx.viewer, this);
  }
}

function snake(k: string): string {
  return k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}
