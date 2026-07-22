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
  /** Column type for a genuine-JSON field (`x-kanecta-storage: "json"`). */
  json: string;
  /** null ⇒ no array columns (decompose to a child value-table). */
  arrayColumn: ((base: string) => string) | null;
  /**
   * Render a generated/computed column's definition (everything after the
   * quoted column name), e.g. `TEXT GENERATED ALWAYS AS (<expr>) STORED`.
   * null ⇒ computed columns unsupported (compile error when one is declared).
   */
  computedColumn: ((sqlType: string, expression: string, stored: boolean) => string) | null;
  /**
   * Render the DDL statement(s) for a single trigger on `table`. `name` is the
   * resolved (deterministic or explicit) trigger name. Returns one or more DDL
   * strings. null ⇒ triggers unsupported (compile error when one is declared).
   */
  trigger: ((table: string, t: TriggerDecl, name: string) => string[]) | null;
  /**
   * Render `CREATE ... FUNCTION` DDL for a stored function; `returns` is the
   * already-resolved return type. null ⇒ stored functions unsupported (omitted).
   */
  storedFunction: ((fn: StoredFunctionDecl, returns: string) => string) | null;
}

/** A single property in a flat type `jsonSchema`. */
export interface JsonSchemaProp {
  type?: string | string[];
  format?: string;
  typeId?: string;
  'x-kanecta-itemType'?: string;
  /**
   * `"json"` marks a field whose value is genuine JSON content (e.g. a stored
   * JSON Schema document, rich-text editor state) — the one sanctioned case for a
   * JSON column. Any OTHER object-typed field is a compile error: normalise it
   * into its own type referenced by `typeId` (the flat one-level rule).
   */
  'x-kanecta-storage'?: string;
  items?: JsonSchemaProp;
}

export interface JsonSchema {
  properties?: Record<string, JsonSchemaProp>;
}

/**
 * A declared generated/computed column on a type's per-type table. Authored
 * input, peer to `jsonSchema`. Its value is computed by the database from an
 * `expression` over this table's own (snake_case) columns; the column is never
 * written directly. See `deriveSqlSchema` (emitted inside the CREATE TABLE).
 */
export interface ComputedColumnDecl {
  /** SQL expression over this table's own (snake_case) columns. */
  expression: string;
  /** jsonSchema scalar type ('string'|'integer'|'number'|'boolean'). */
  type: string;
  /** STORED (materialised) when true; otherwise VIRTUAL (computed on read). */
  stored?: boolean;
}

/**
 * A declared trigger on a type's per-type table. Authored input, peer to
 * `jsonSchema`; the compiler turns it into `CREATE TRIGGER` DDL per dialect.
 * See `deriveTriggerDdl`.
 */
export interface TriggerDecl {
  /** Explicit trigger name; when absent a deterministic name is derived. */
  name?: string;
  timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  /** One or more firing events. */
  events: ('INSERT' | 'UPDATE' | 'DELETE')[];
  /** Postgres granularity; defaults to 'row'. (SQLite is always per-row.) */
  forEach?: 'row' | 'statement';
  /** Optional WHEN predicate over NEW/OLD. */
  when?: string;
  /** Postgres: the stored function to EXECUTE (id or name). */
  functionId?: string;
  functionName?: string;
  /** SQLite: the inline trigger body (BEGIN <body>; END). */
  body?: string;
}

/**
 * A declared stored function. Authored input, peer to `jsonSchema`; the compiler
 * turns it into `CREATE OR REPLACE FUNCTION` DDL (Postgres only). Emitted before
 * the table so triggers can reference it. See `deriveFunctionDdl`.
 */
export interface StoredFunctionDecl {
  name: string;
  /** 'trigger' or a jsonSchema scalar type. */
  returns: string;
  /** Procedural language; defaults to 'plpgsql'. */
  language?: string;
  body: string;
}

export interface DeriveOptions {
  typeId?: string;
  dialect?: DialectName;
  /**
   * Declared generated/computed columns, keyed by (camelCase) column name.
   * Emitted inline in the CREATE TABLE by `deriveSqlSchema`.
   */
  computedColumns?: Record<string, ComputedColumnDecl>;
}

/**
 * A declared secondary index on a type's per-type table (spec: typePayload
 * `indexes`). Authored input, peer to `jsonSchema`; the compiler turns it into
 * `CREATE INDEX` DDL per dialect. See `deriveIndexDdl`.
 */
export interface IndexDecl {
  /** One or more jsonSchema property names (camelCase). Compound = ordered. */
  fields: string[];
  /** Emit a UNIQUE index (has constraint force at the storage layer). */
  unique?: boolean;
  /** Index a case-folded expression (Postgres/ansi lower(); SQLite COLLATE NOCASE). */
  caseInsensitive?: boolean;
  /** Partial-index predicate over this table's own (snake_case) columns. */
  where?: string;
  /** Explicit index name; when absent a deterministic name is derived. */
  name?: string;
}

export const DIALECTS: Record<DialectName, Dialect> = {
  postgres: {
    string: 'TEXT',
    integer: 'BIGINT',
    number: 'DOUBLE PRECISION',
    boolean: 'BOOLEAN',
    uuid: 'UUID',
    json: 'JSONB',
    arrayColumn: (base) => `${base}[]`, // native array
    computedColumn: (sqlType, expression, stored) =>
      `${sqlType} GENERATED ALWAYS AS (${expression}) ${stored ? 'STORED' : 'VIRTUAL'}`,
    trigger: (table, t, name) => {
      const fn = t.functionName || t.functionId;
      if (!fn) {
        throw new Error(
          `deriveTriggerDdl: postgres trigger "${name}" requires a functionName or functionId to EXECUTE`,
        );
      }
      const events = t.events.join(' OR ');
      const forEach = (t.forEach || 'row').toUpperCase();
      const when = t.when && t.when.trim() ? ` WHEN (${t.when.trim()})` : '';
      return [
        `DROP TRIGGER IF EXISTS ${q(name)} ON ${q(table)};\n` +
          `CREATE TRIGGER ${q(name)} ${t.timing} ${events} ON ${q(table)} ` +
          `FOR EACH ${forEach}${when} EXECUTE FUNCTION ${q(fn)}()`,
      ];
    },
    storedFunction: (fn, returns) =>
      `CREATE OR REPLACE FUNCTION ${q(fn.name)}() RETURNS ${returns} ` +
      `LANGUAGE ${fn.language || 'plpgsql'} AS $$\n${fn.body}\n$$`,
  },
  sqlite: {
    string: 'TEXT',
    integer: 'INTEGER',
    number: 'REAL',
    boolean: 'INTEGER',
    uuid: 'TEXT',
    json: 'TEXT', // JSON stored as text
    arrayColumn: () => 'TEXT', // JSON-encoded
    computedColumn: (sqlType, expression, stored) =>
      `${sqlType} GENERATED ALWAYS AS (${expression}) ${stored ? 'STORED' : 'VIRTUAL'}`,
    trigger: (table, t, name) => {
      const body = (t.body || '').trim();
      if (!body) {
        throw new Error(`deriveTriggerDdl: sqlite trigger "${name}" requires an inline body`);
      }
      const inner = body.replace(/;+\s*$/, ''); // avoid a doubled BEGIN <body>;; END
      const when = t.when && t.when.trim() ? ` WHEN (${t.when.trim()})` : '';
      const multi = t.events.length > 1;
      // SQLite has no EXECUTE FUNCTION — one CREATE TRIGGER per event, inline body.
      return t.events.map((ev) => {
        const trg = multi ? `${name}_${ev.toLowerCase()}` : name;
        return (
          `CREATE TRIGGER ${q(trg)} ${t.timing} ${ev} ON ${q(table)} ` +
          `FOR EACH ROW${when} BEGIN ${inner}; END`
        );
      });
    },
    storedFunction: null, // no stored functions
  },
  ansi: {
    string: 'CLOB', // large text of any size (decision #4)
    integer: 'BIGINT',
    number: 'DOUBLE PRECISION',
    boolean: 'BOOLEAN',
    uuid: 'CHAR(36)',
    json: 'CLOB', // JSON stored as portable text
    arrayColumn: null, // no array columns — decompose to a child value-table
    computedColumn: null, // portable ANSI — no generated columns
    trigger: null, // no portable trigger form
    storedFunction: null, // no stored functions
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

// JSON Schema expresses a nullable field as a type union — `type: ['boolean','null']`
// means "boolean or null". Collapse such a union to its single non-null member so a
// nullable scalar still maps to its real SQL type instead of degrading to TEXT.
function baseType(prop: JsonSchemaProp | undefined): string | undefined {
  const t = prop && prop.type;
  if (Array.isArray(t)) return t.find((x) => x !== 'null');
  return t as string | undefined;
}

/** Map a scalar (or ref) property to a base SQL type for a dialect. */
function scalarType(prop: JsonSchemaProp | undefined, d: Dialect): { sql: string; ref: boolean } {
  if (isRef(prop)) return { sql: d.uuid, ref: true };
  const t = baseType(prop);
  if (t === 'integer') return { sql: d.integer, ref: false };
  if (t === 'number') return { sql: d.number, ref: false };
  if (t === 'boolean') return { sql: d.boolean, ref: false };
  if (t === 'object') {
    // The ONLY sanctioned JSON column: a field whose value is genuine JSON
    // content (a stored JSON Schema document, rich-text state), marked explicitly.
    if (prop && prop['x-kanecta-storage'] === 'json') return { sql: d.json, ref: false };
    // Any other object field is forbidden — a JSON column here is just avoiding
    // normalisation. Make it its own type, referenced by typeId (flat one-level rule).
    throw new Error(
      'deriveSqlSchema: an object-typed field cannot be a column. Normalise it into its ' +
      'own type referenced by typeId (the flat one-level rule), or — only if it holds ' +
      'genuine JSON content — mark it "x-kanecta-storage": "json".',
    );
  }
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
  const { typeId, dialect = 'postgres', computedColumns } = opts;
  if (!typeId) throw new Error('deriveSqlSchema: typeId is required');
  const d = DIALECTS[dialect];
  if (!d) throw new Error(`deriveSqlSchema: unknown dialect "${dialect}"`);

  const table = objTableName(typeId);
  const props = (jsonSchema && jsonSchema.properties) || {};

  const columns = [`  item_id ${d.uuid} NOT NULL`];
  const childTables: string[] = [];

  for (const [name, prop] of Object.entries(props)) {
    const col = snake(name);

    if (baseType(prop) === 'array') {
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
    // A UUID reference to another item is a plain UUID column — deliberately
    // NOT a foreign key to items(id). Under the item_archive model a reference
    // may legitimately point at an ARCHIVED item (soft delete physically moves
    // the row out of `items`; the relation survives per the spec's
    // type-relation rule), and one FK cannot span the items ∪ item_archive
    // union. Referential integrity for reference columns is verified by the
    // integrity checker over the union instead. The spine FK (item_id → items,
    // ON DELETE CASCADE) below is unaffected — an obj_ row's own item can
    // never be archived while the row exists (the archive move removes it).
    void ref;
    columns.push(`  ${q(col)} ${sql}`);
  }

  // Generated/computed columns are emitted inline in the CREATE TABLE, after the
  // stored columns they may reference.
  for (const [name, cc] of Object.entries(computedColumns || {})) {
    if (!d.computedColumn) {
      throw new Error(
        `deriveSqlSchema: dialect "${dialect}" does not support computed columns (field "${name}")`,
      );
    }
    const { sql } = scalarType({ type: cc.type }, d);
    columns.push(`  ${q(snake(name))} ${d.computedColumn(sql, cc.expression, Boolean(cc.stored))}`);
  }

  columns.push(`  CONSTRAINT ${q('pk_' + table)} PRIMARY KEY (item_id)`);
  columns.push(`  CONSTRAINT ${q('fk_' + table + '_item')} FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE`);

  const objTable = `CREATE TABLE ${q(table)} (\n${columns.join(',\n')}\n)`;
  return [objTable, ...childTables];
}

/** Deterministic, stable index name: idx_<table>_<f1>_<f2>[_uq][_ci]. */
function indexName(table: string, idx: IndexDecl): string {
  if (idx.name) return idx.name;
  const parts = ['idx', table, ...idx.fields.map(snake)];
  if (idx.unique) parts.push('uq');
  if (idx.caseInsensitive) parts.push('ci');
  return parts.join('_');
}

/**
 * Derive `CREATE INDEX` DDL for a type's declared `indexes`. Returns one
 * statement per declaration, ordered as given. Like `deriveSqlSchema`, the DDL
 * is plain (no `IF NOT EXISTS`) — the adapters wrap creation with their own
 * guards under the write lock.
 *
 * Every field must be a property of `jsonSchema` (else a compile error).
 * `caseInsensitive` requires every field to be a text column. `dialect`
 * defaults to 'postgres'.
 */
export function deriveIndexDdl(
  jsonSchema: JsonSchema,
  indexes: IndexDecl[] | undefined,
  opts: DeriveOptions = {},
): string[] {
  const { typeId, dialect = 'postgres' } = opts;
  if (!typeId) throw new Error('deriveIndexDdl: typeId is required');
  const d = DIALECTS[dialect];
  if (!d) throw new Error(`deriveIndexDdl: unknown dialect "${dialect}"`);
  if (!indexes || indexes.length === 0) return [];

  const table = objTableName(typeId);
  const props = (jsonSchema && jsonSchema.properties) || {};

  return indexes.map((idx) => {
    if (!idx.fields || idx.fields.length === 0) {
      throw new Error('deriveIndexDdl: an index entry must declare at least one field');
    }
    for (const f of idx.fields) {
      if (!Object.prototype.hasOwnProperty.call(props, f)) {
        throw new Error(
          `deriveIndexDdl: index field "${f}" is not a property of the type's jsonSchema`,
        );
      }
    }
    if (idx.caseInsensitive) {
      for (const f of idx.fields) {
        const prop = props[f];
        const t = baseType(prop);
        // Text = a string scalar or an array of strings; refs/ints/etc. cannot fold case.
        const isText = !isRef(prop) && (t === 'string' || t === 'array' || t === undefined);
        if (!isText) {
          throw new Error(
            `deriveIndexDdl: caseInsensitive index requires text columns; field "${f}" is not text`,
          );
        }
      }
    }

    const cols = idx.fields.map((f) => {
      const col = snake(f);
      if (idx.caseInsensitive) {
        return dialect === 'sqlite' ? `${q(col)} COLLATE NOCASE` : `lower(${q(col)})`;
      }
      return q(col);
    });

    const unique = idx.unique ? 'UNIQUE ' : '';
    let stmt = `CREATE ${unique}INDEX ${q(indexName(table, idx))} ON ${q(table)} (${cols.join(', ')})`;
    if (idx.where && idx.where.trim()) stmt += ` WHERE ${idx.where.trim()}`;
    return stmt;
  });
}

/** Deterministic, stable trigger name: trg_<table>_<timing>_<e1>[_e2...]. */
function triggerName(table: string, t: TriggerDecl): string {
  if (t.name) return t.name;
  const parts = [
    'trg',
    table,
    t.timing.toLowerCase().replace(/\s+/g, '_'),
    ...t.events.map((e) => e.toLowerCase()),
  ];
  return parts.join('_');
}

/**
 * Derive `CREATE TRIGGER` DDL for a type's declared `triggers`. Returns the DDL
 * statements ordered as given (Postgres emits a DROP+CREATE pair per trigger;
 * SQLite emits one CREATE TRIGGER per event). The `ansi` dialect has no portable
 * trigger form and rejects any declared trigger. `dialect` defaults to
 * 'postgres'.
 */
export function deriveTriggerDdl(
  triggers: TriggerDecl[] | undefined,
  opts: DeriveOptions = {},
): string[] {
  const { typeId, dialect = 'postgres' } = opts;
  if (!typeId) throw new Error('deriveTriggerDdl: typeId is required');
  const d = DIALECTS[dialect];
  if (!d) throw new Error(`deriveTriggerDdl: unknown dialect "${dialect}"`);
  if (!triggers || triggers.length === 0) return [];

  const table = objTableName(typeId);
  const out: string[] = [];
  for (const t of triggers) {
    if (!t.timing) throw new Error('deriveTriggerDdl: a trigger must declare a timing');
    if (!t.events || t.events.length === 0) {
      throw new Error('deriveTriggerDdl: a trigger must declare at least one event');
    }
    if (!d.trigger) {
      throw new Error(`deriveTriggerDdl: dialect "${dialect}" does not support triggers`);
    }
    out.push(...d.trigger(table, t, triggerName(table, t)));
  }
  return out;
}

/**
 * Derive `CREATE OR REPLACE FUNCTION` DDL for a type's declared `storedFunctions`
 * (Postgres only; other dialects have no stored-function form and omit them).
 * These must be emitted BEFORE the table so triggers can reference them. A
 * scalar `returns` maps through the dialect's scalar types; `returns: 'trigger'`
 * is passed through verbatim. `dialect` defaults to 'postgres'.
 */
export function deriveFunctionDdl(
  functions: StoredFunctionDecl[] | undefined,
  opts: DeriveOptions = {},
): string[] {
  const { typeId, dialect = 'postgres' } = opts;
  if (!typeId) throw new Error('deriveFunctionDdl: typeId is required');
  const d = DIALECTS[dialect];
  if (!d) throw new Error(`deriveFunctionDdl: unknown dialect "${dialect}"`);
  if (!functions || functions.length === 0) return [];
  if (!d.storedFunction) return []; // unsupported dialect — omit.

  return functions.map((fn) => {
    if (!fn.name) throw new Error('deriveFunctionDdl: a stored function must have a name');
    if (!fn.body) {
      throw new Error(`deriveFunctionDdl: stored function "${fn.name}" requires a body`);
    }
    const returns =
      fn.returns === 'trigger' ? 'trigger' : scalarType({ type: fn.returns }, d).sql;
    return d.storedFunction!(fn, returns);
  });
}

/**
 * Full derived DDL for a type: stored functions first (so triggers can reference
 * them), then the object table(s) from `jsonSchema` (with any computed columns
 * inline), then the `CREATE INDEX` statements, then the `CREATE TRIGGER`
 * statements. This is the complete `sqlSchema` an adapter materialises for a
 * per-type projection.
 */
export function deriveFullSchema(
  jsonSchema: JsonSchema,
  opts: DeriveOptions & {
    indexes?: IndexDecl[];
    triggers?: TriggerDecl[];
    storedFunctions?: StoredFunctionDecl[];
  } = {},
): string[] {
  const { indexes, triggers, storedFunctions, ...deriveOpts } = opts;
  return [
    ...deriveFunctionDdl(storedFunctions, deriveOpts),
    ...deriveSqlSchema(jsonSchema, deriveOpts),
    ...deriveIndexDdl(jsonSchema, indexes, deriveOpts),
    ...deriveTriggerDdl(triggers, deriveOpts),
  ];
}
