/**
 * jsonSchema → sqlSchema compiler.
 *
 * A Kanecta type's storage is DERIVED from its `jsonSchema`, never hand-authored
 * (decision #2). The canonical model is portable to ANY ANSI SQL database
 * (decision #3): only scalar column types, no JSON columns, no array columns. A
 * scalar-array field therefore decomposes into a child value-table in the `ansi`
 * dialect, while the `postgres` dialect MAY use a native array column as a
 * performance optimisation, and `sqlite` stores it as JSON text — same logical
 * shape, three physical forms.
 *
 * `deriveSqlSchema(jsonSchema, { typeId, dialect })` returns an ordered array of
 * DDL strings: the object table first, then any child value-tables (ansi arrays).
 *
 * Input `jsonSchema` is a flat, one-level type schema:
 *   properties: {
 *     <name>: { type: 'string'|'integer'|'number'|'boolean' }        // scalar
 *           | { type: 'string', format: 'uuid', typeId|x-kanecta-itemType } // ref
 *           | { type: 'array', items: <scalar-or-ref> }              // multi-valued
 *   }
 */

export type DialectName = 'postgres' | 'sqlite' | 'ansi';

export interface Dialect {
  string: string;
  integer: string;
  number: string;
  boolean: string;
  uuid: string;
  /** null ⇒ no array columns (decompose to a child value-table). */
  arrayColumn: ((base: string) => string) | null;
}

/** A single property in a flat type `jsonSchema`. */
export interface JsonSchemaProp {
  type?: string;
  format?: string;
  typeId?: string;
  'x-kanecta-itemType'?: string;
  items?: JsonSchemaProp;
}

export interface JsonSchema {
  properties?: Record<string, JsonSchemaProp>;
}

export interface DeriveOptions {
  typeId?: string;
  dialect?: DialectName;
}

export const DIALECTS: Record<DialectName, Dialect> = {
  postgres: {
    string: 'TEXT',
    integer: 'BIGINT',
    number: 'DOUBLE PRECISION',
    boolean: 'BOOLEAN',
    uuid: 'UUID',
    arrayColumn: (base) => `${base}[]`, // native array
  },
  sqlite: {
    string: 'TEXT',
    integer: 'INTEGER',
    number: 'REAL',
    boolean: 'INTEGER',
    uuid: 'TEXT',
    arrayColumn: () => 'TEXT', // JSON-encoded
  },
  ansi: {
    string: 'CLOB', // large text of any size (decision #4)
    integer: 'BIGINT',
    number: 'DOUBLE PRECISION',
    boolean: 'BOOLEAN',
    uuid: 'CHAR(36)',
    arrayColumn: null, // no array columns — decompose to a child value-table
  },
};

const snake = (k: string): string => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/** obj_<typeId> with hyphens as underscores. */
export function objTableName(typeId: string): string {
  return `obj_${String(typeId).replace(/-/g, '_')}`;
}

function isRef(prop: JsonSchemaProp | undefined): boolean {
  return Boolean(prop && (prop.typeId || prop['x-kanecta-itemType'] || prop.format === 'uuid'));
}

/** Map a scalar (or ref) property to a base SQL type for a dialect. */
function scalarType(prop: JsonSchemaProp | undefined, d: Dialect): { sql: string; ref: boolean } {
  if (isRef(prop)) return { sql: d.uuid, ref: true };
  const t = prop && prop.type;
  if (t === 'integer') return { sql: d.integer, ref: false };
  if (t === 'number') return { sql: d.number, ref: false };
  if (t === 'boolean') return { sql: d.boolean, ref: false };
  // string and anything unspecified fall back to the string type (portable text).
  return { sql: d.string, ref: false };
}

function q(id: string): string {
  return `"${id}"`;
}

/**
 * Derive the DDL for a type. Returns ordered DDL statements (object table, then
 * any child value-tables). `dialect` defaults to 'postgres'.
 */
export function deriveSqlSchema(jsonSchema: JsonSchema, opts: DeriveOptions = {}): string[] {
  const { typeId, dialect = 'postgres' } = opts;
  if (!typeId) throw new Error('deriveSqlSchema: typeId is required');
  const d = DIALECTS[dialect];
  if (!d) throw new Error(`deriveSqlSchema: unknown dialect "${dialect}"`);

  const table = objTableName(typeId);
  const props = (jsonSchema && jsonSchema.properties) || {};

  const columns = [`  item_id ${d.uuid} NOT NULL`];
  const childTables: string[] = [];

  for (const [name, prop] of Object.entries(props)) {
    const col = snake(name);

    if (prop && prop.type === 'array') {
      const base = scalarType(prop.items || { type: 'string' }, d);
      if (d.arrayColumn) {
        // Native array column (postgres) / JSON text (sqlite).
        columns.push(`  ${q(col)} ${d.arrayColumn(base.sql)}`);
      } else {
        // ANSI: decompose the multi-valued field into an ordered child table.
        const childName = `${table}_${col}`;
        childTables.push(
          `CREATE TABLE ${q(childName)} (\n` +
          `  item_id ${d.uuid} NOT NULL,\n` +
          `  ord INTEGER NOT NULL,\n` +
          `  value ${base.sql},\n` +
          `  CONSTRAINT ${q('pk_' + childName)} PRIMARY KEY (item_id, ord),\n` +
          `  CONSTRAINT ${q('fk_' + childName)} FOREIGN KEY (item_id) REFERENCES ${q(table)} (item_id) ON DELETE CASCADE\n` +
          `)`,
        );
      }
      continue;
    }

    const { sql, ref } = scalarType(prop, d);
    // A UUID reference to another item gets a foreign key to items(id).
    columns.push(`  ${q(col)} ${sql}${ref ? ' REFERENCES items(id)' : ''}`);
  }

  columns.push(`  CONSTRAINT ${q('pk_' + table)} PRIMARY KEY (item_id)`);
  columns.push(`  CONSTRAINT ${q('fk_' + table + '_item')} FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE`);

  const objTable = `CREATE TABLE ${q(table)} (\n${columns.join(',\n')}\n)`;
  return [objTable, ...childTables];
}
