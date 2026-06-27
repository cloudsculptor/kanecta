'use strict';

// Suggests per-type table DDL for a Kanecta custom type, from its jsonSchema.
//
// IMPORTANT: this is NOT what the adapter runs at type-creation time. Per
// type.json (see file-specs/type.json and specification.db.postgres.md §2),
// every type author-defines a `sqlSchema` — the canonical, immutable DDL that
// actually creates its storage. This module exists to produce a *starting-point
// suggestion* (e.g. for a UI to pre-fill `sqlSchema` for the author to refine).
//
// Kanecta types are flat — exactly one level deep — so the mapping is mechanical
// and near 1:1, with every type mapping to exactly ONE table:
//   - primitive property                -> native column
//   - array-of-primitives property      -> native array column
//   - typeId-reference property         -> UUID column, FK to items(id)
// Inline nested objects / arrays of objects are not permitted (a reusable nested
// concept must be its own standalone type, referenced via typeId).
//
// Naming convention: obj_<uuid-with-hyphens-replaced-by-underscores>, columns
// named to match jsonSchema property names. Strict 1:1 with items via
// item_id PRIMARY KEY REFERENCES items(id).

const UUID_HEX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Raw UUIDs aren't valid unquoted SQL identifiers (they start with a digit and
// contain hyphens) — replace hyphens with underscores and prefix with "obj_".
function tableNameForType(typeId) {
  if (!UUID_HEX_RE.test(typeId)) throw new Error(`Not a UUID: ${typeId}`);
  return `obj_${typeId.replace(/-/g, '_')}`;
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

// Maps a primitive JSON Schema property definition to a SQL column type.
// Returns null if the schema isn't a primitive (caller decides what to do).
function scalarSqlType(schema) {
  switch (schema.type) {
    case 'string':
      switch (schema.format) {
        case 'date': return 'DATE';
        case 'date-time': return 'TIMESTAMPTZ';
        case 'uuid': return schema.typeId ? null : 'UUID'; // typeId references handled separately
        default: return 'TEXT';
      }
    case 'integer': return 'INTEGER';
    case 'number': return 'NUMERIC';
    case 'boolean': return 'BOOLEAN';
    default: return null;
  }
}

// Plans the columns for a type's table from its jsonSchema.properties.
// Returns [{ name, sqlType, references }] — `references` is set ('items') for
// typeId-reference columns, which need an FK constraint.
function planColumns(properties) {
  const columns = [];

  for (const [propName, propSchema] of Object.entries(properties ?? {})) {
    if (propSchema.type === 'string' && propSchema.format === 'uuid' && propSchema.typeId) {
      columns.push({ name: propName, sqlType: 'UUID', references: 'items' });
      continue;
    }

    const scalarType = scalarSqlType(propSchema);
    if (scalarType) {
      columns.push({ name: propName, sqlType: scalarType });
      continue;
    }

    if (propSchema.type === 'array') {
      const itemScalarType = scalarSqlType(propSchema.items ?? {});
      if (itemScalarType) {
        columns.push({ name: propName, sqlType: `${itemScalarType}[]` });
        continue;
      }
    }

    throw new Error(
      `Property "${propName}" is not a flat shape (primitive, array-of-primitives, ` +
      `or typeId reference) — Kanecta types are flat; nest via a standalone type instead.`,
    );
  }

  return columns;
}

// Generates the single CREATE TABLE statement for a type's table.
function generateCreateTableSQL(typeId, jsonSchema) {
  const tableName = tableNameForType(typeId);
  const columns = planColumns(jsonSchema?.properties);

  const lines = [`    item_id UUID NOT NULL`];
  for (const col of columns) {
    lines.push(`    ${quoteIdent(col.name)} ${col.sqlType}`);
  }
  lines.push(`    CONSTRAINT ${quoteIdent(`pk_${tableName}`)} PRIMARY KEY (item_id)`);
  lines.push(`    CONSTRAINT ${quoteIdent(`fk_${tableName}_item`)} FOREIGN KEY (item_id) REFERENCES items(id)`);
  for (const col of columns) {
    if (col.references) {
      lines.push(
        `    CONSTRAINT ${quoteIdent(`fk_${tableName}_${col.name}`)} FOREIGN KEY (${quoteIdent(col.name)}) REFERENCES ${col.references}(id)`,
      );
    }
  }

  return [`CREATE TABLE ${quoteIdent(tableName)} (\n${lines.join(',\n')}\n)`];
}

module.exports = { tableNameForType, generateCreateTableSQL, planColumns, scalarSqlType };
