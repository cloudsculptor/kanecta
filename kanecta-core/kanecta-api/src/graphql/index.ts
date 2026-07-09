// The generic type-items → GraphQL engine (schema generation half).
//
// This is "the ONLY code is the generic engine" from the cutover plan: a single,
// domain-agnostic transformer from `type` items to a GraphQL surface. It carries
// NO per-domain and NO per-view logic — community-hub's screens are expressed as
// data (type items + `x-graphql` declarations + view/query items), never here.
//
// Two halves:
//   1. buildSchemaModel  — type items → SchemaModel IR (this package, done).
//   2. a Postgres-bound executor that walks each field's `backing` — deferred
//      (needs a live datastore; see resolverPlan() for the seam it consumes).
//
// Usage:
//   const model = buildSchemaModel(await ds.getItemsOfType('type'));
//   const sdl = emitSDL(model);                 // feed to graphql-js buildSchema
//   const plan = resolverPlan(model);           // drives the executor's resolvers

export { buildSchemaModel } from './model.ts';
export type {
  SchemaModel,
  ObjectTypeModel,
  FieldModel,
  Backing,
  ScalarColumnBacking,
  ReferenceBacking,
  ContainmentBacking,
  ComputedBacking,
  IdentityBacking,
  Diagnostic,
  BuildOptions,
} from './model.ts';
export { emitSDL } from './sdl.ts';
export { compileSelect, compileWhere, compileOrderBy, QueryCompileError } from './sql-query.ts';
export type { CompiledQuery, SelectArgs } from './sql-query.ts';
export { mapProperty, scalarGraphqlType, filterInputFor, CUSTOM_SCALARS } from './scalars.ts';
export { graphqlTypeName, singularQueryField, listQueryField, pluralize } from './naming.ts';
export { applyNamingStrategy, camelToSnake, snakeToCamel } from './naming-strategy.ts';
export type { NamingStrategy } from './naming-strategy.ts';
export type {
  XGraphqlType,
  XGraphqlProperty,
  XGraphqlField,
  XGraphqlContainmentField,
  XGraphqlReferenceField,
  XGraphqlComputedField,
  ComputedScope,
} from './vocabulary.ts';

import type { SchemaModel, Backing } from './model.ts';

/** A flat, executor-friendly index of every field's backing, keyed by
 *  `TypeName.fieldName`. The future Postgres executor builds its graphql-js
 *  resolver map by looking each field up here — the model stays the single
 *  source of truth for "how is this field fetched". */
export function resolverPlan(model: SchemaModel): Map<string, Backing> {
  const plan = new Map<string, Backing>();
  for (const type of model.types) {
    for (const field of type.fields) {
      plan.set(`${type.name}.${field.name}`, field.backing);
    }
  }
  return plan;
}
