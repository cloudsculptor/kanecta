// emitSDL — renders a SchemaModel to GraphQL SDL (schema definition language).
//
// Pure string emission, no graphql-js dependency: the SDL is human-reviewable
// and diffable, and a later step can feed it to graphql-js `buildSchema` for
// execution without changing this module. The generated surface implements G1
// (HTTP query/filter/sort/pagination) as data-driven `where`/`sort`/`limit`/
// `offset` arguments on every list query field.

import { filterInputFor } from './scalars.ts';
import type { SchemaModel, ObjectTypeModel, FieldModel } from './model.ts';

const FILTER_INPUTS: Record<string, string> = {
  StringFilter: `input StringFilter {
  eq: String
  ne: String
  in: [String!]
  contains: String
  startsWith: String
  isNull: Boolean
}`,
  IntFilter: `input IntFilter {
  eq: Int
  ne: Int
  in: [Int!]
  gt: Int
  gte: Int
  lt: Int
  lte: Int
  isNull: Boolean
}`,
  FloatFilter: `input FloatFilter {
  eq: Float
  ne: Float
  in: [Float!]
  gt: Float
  gte: Float
  lt: Float
  lte: Float
  isNull: Boolean
}`,
  BooleanFilter: `input BooleanFilter {
  eq: Boolean
  ne: Boolean
  isNull: Boolean
}`,
  IDFilter: `input IDFilter {
  eq: ID
  ne: ID
  in: [ID!]
  isNull: Boolean
}`,
  DateTimeFilter: `input DateTimeFilter {
  eq: DateTime
  ne: DateTime
  gt: DateTime
  gte: DateTime
  lt: DateTime
  lte: DateTime
  isNull: Boolean
}`,
};

// A field is filterable/sortable when it reads a single scalar column (or is the
// id identity field). List columns and object-valued fields are excluded.
function scalarFilterFields(type: ObjectTypeModel): { field: FieldModel; filterInput: string }[] {
  const out: { field: FieldModel; filterInput: string }[] = [];
  for (const f of type.fields) {
    const isScalarCol = f.backing.kind === 'scalarColumn' && !f.backing.list;
    const isId = f.backing.kind === 'identity' && f.backing.field === 'id';
    if (!isScalarCol && !isId) continue;
    const filterInput = filterInputFor(f.namedType);
    if (filterInput) out.push({ field: f, filterInput });
  }
  return out;
}

function indentDescription(description: string | undefined, indent: string): string {
  if (!description) return '';
  const escaped = description.replace(/"""/g, '\\"\\"\\"');
  return `${indent}"""${escaped}"""\n`;
}

function emitObjectType(type: ObjectTypeModel): string {
  const lines: string[] = [];
  if (type.description) lines.push(`"""${type.description.replace(/"""/g, '\\"\\"\\"')}"""`);
  lines.push(`type ${type.name} {`);
  for (const f of type.fields) {
    lines.push(`${indentDescription(f.description, '  ')}  ${f.name}: ${f.graphqlType}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function emitWhereInput(type: ObjectTypeModel): string {
  const filterFields = scalarFilterFields(type);
  const lines = [`input ${type.name}Where {`];
  lines.push(`  and: [${type.name}Where!]`);
  lines.push(`  or: [${type.name}Where!]`);
  lines.push(`  not: ${type.name}Where`);
  for (const { field, filterInput } of filterFields) {
    lines.push(`  ${field.name}: ${filterInput}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function emitSortEnum(type: ObjectTypeModel): string {
  const filterFields = scalarFilterFields(type);
  const lines = [`enum ${type.name}SortField {`];
  for (const { field } of filterFields) lines.push(`  ${field.name}`);
  lines.push('}');
  return lines.join('\n');
}

function emitSortInput(type: ObjectTypeModel): string {
  return `input ${type.name}Sort {
  field: ${type.name}SortField!
  direction: SortDirection = ASC
  nulls: NullsOrder
}`;
}

function emitQueryRoot(model: SchemaModel): string {
  const lines = ['type Query {'];
  for (const type of model.types) {
    lines.push(`  ${type.queryName}(id: ID!): ${type.name}`);
    lines.push(
      `  ${type.listQueryName}(where: ${type.name}Where, sort: [${type.name}Sort!], limit: Int = 50, offset: Int = 0): [${type.name}!]!`,
    );
  }
  lines.push('}');
  return lines.join('\n');
}

/** Render the full SDL document for a SchemaModel. */
export function emitSDL(model: SchemaModel): string {
  const blocks: string[] = [];

  // Custom scalars.
  for (const s of model.customScalars) {
    const doc =
      s === 'DateTime'
        ? 'ISO-8601 date-time string. Serialized as the stored string (identity), preserving byte-for-byte compatibility with existing consumers.'
        : 'Arbitrary JSON value.';
    blocks.push(`"""${doc}"""\nscalar ${s}`);
  }

  // Shared enums for sorting.
  blocks.push(`enum SortDirection {
  ASC
  DESC
}`);
  blocks.push(`enum NullsOrder {
  FIRST
  LAST
}`);

  // Shared filter inputs — only those actually referenced.
  const usedFilters = new Set<string>();
  for (const type of model.types) {
    for (const { filterInput } of scalarFilterFields(type)) usedFilters.add(filterInput);
  }
  for (const name of Object.keys(FILTER_INPUTS)) {
    if (usedFilters.has(name)) blocks.push(FILTER_INPUTS[name]);
  }

  // Per-type object, where, sort.
  for (const type of model.types) {
    blocks.push(emitObjectType(type));
    blocks.push(emitWhereInput(type));
    blocks.push(emitSortEnum(type));
    blocks.push(emitSortInput(type));
  }

  // Root query.
  blocks.push(emitQueryRoot(model));

  return blocks.join('\n\n') + '\n';
}
