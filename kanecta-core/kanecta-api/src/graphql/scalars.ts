// Maps a flat jsonSchema property to a GraphQL type reference + a description of
// how it is stored, so the engine can both emit SDL and plan resolution.
//
// The mapping deliberately mirrors the postgres adapter's column planner
// (kanecta-postgres/src/type-table.ts): Kanecta types are flat (exactly one
// level deep), so every property is a primitive, an array-of-primitives, or a
// typeId reference. This 1:1 correspondence means a GraphQL scalar field reads
// exactly one obj_<type> column.

/** Custom scalars the engine relies on beyond GraphQL's built-ins. Both are
 *  identity string/JSON passthroughs at serialization time (documented so the
 *  community-hub projection stays byte-compatible: DateTime serializes as the
 *  stored ISO-8601 string). */
export const CUSTOM_SCALARS = ['DateTime', 'JSON'] as const;

/** GraphQL kind of a mapped property. */
export type ScalarKind = 'scalar' | 'reference';

export interface MappedScalar {
  kind: ScalarKind;
  /** GraphQL type name WITHOUT list/non-null decoration (e.g. "String", "Int",
   *  "DateTime", "ID", or a referenced object type name for references). */
  graphqlType: string;
  /** True when the property is an array-of-primitives → a GraphQL list. */
  list: boolean;
  /** For `kind:'reference'`: UUID of the referenced Kanecta type (the property's
   *  `typeId`). Undefined for plain scalars. */
  referenceTypeId?: string;
}

/** Maps one JSON-Schema property definition to a GraphQL type reference.
 *  Returns null if the property is not a flat shape (caller decides — the same
 *  contract as the SQL column planner, which throws). */
export function mapProperty(propSchema: any): MappedScalar | null {
  // typeId reference (format:uuid + typeId) → an object-type field.
  if (propSchema?.type === 'string' && propSchema?.format === 'uuid' && propSchema?.typeId) {
    return { kind: 'reference', graphqlType: 'ID', list: false, referenceTypeId: propSchema.typeId };
  }

  const scalar = scalarGraphqlType(propSchema);
  if (scalar) return { kind: 'scalar', graphqlType: scalar, list: false };

  // Array-of-primitives → a GraphQL list of the inner scalar.
  if (propSchema?.type === 'array') {
    const inner = scalarGraphqlType(propSchema.items ?? {});
    if (inner) return { kind: 'scalar', graphqlType: inner, list: true };
  }

  return null;
}

/** Maps a primitive JSON-Schema definition to a GraphQL scalar name. Returns
 *  null for non-primitives. Format-aware: date/date-time → DateTime, uuid → ID.
 *  Mirrors kanecta-postgres/src/type-table.ts `scalarSqlType`. */
export function scalarGraphqlType(schema: any): string | null {
  switch (schema?.type) {
    case 'string':
      switch (schema.format) {
        case 'date':
        case 'date-time':
          return 'DateTime';
        case 'uuid':
          return 'ID';
        default:
          return 'String';
      }
    case 'integer':
      return 'Int';
    case 'number':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    default:
      return null;
  }
}

/** Which shared filter input a GraphQL scalar uses in generated `where` inputs.
 *  Returns null for types with no ordering/equality filter (none currently). */
export function filterInputFor(graphqlType: string): string | null {
  switch (graphqlType) {
    case 'String':
      return 'StringFilter';
    case 'Int':
      return 'IntFilter';
    case 'Float':
      return 'FloatFilter';
    case 'Boolean':
      return 'BooleanFilter';
    case 'ID':
      return 'IDFilter';
    case 'DateTime':
      return 'DateTimeFilter';
    default:
      return null;
  }
}
