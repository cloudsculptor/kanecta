// buildSchemaModel — the heart of the type-items → GraphQL engine.
//
// Given the set of `type` items in a datastore, it produces a SchemaModel: an
// intermediate representation that describes BOTH the GraphQL shape (object
// types, fields, root query fields, where/sort inputs) AND, for every field, its
// resolver BACKING — how the generic executor fetches the value:
//   * scalarColumn  → read one obj_<type> column
//   * reference     → resolve a UUID column (or relationship items) to an object
//   * containment   → the item's children (by parentId), narrowed to a type
//   * computed      → run the referenced function/formula/query item
//   * identity      → a field of the item envelope (id/parentId/value)
//
// The model is intentionally decoupled from execution: SDL emission (sdl.ts)
// consumes it, and a future Postgres-bound executor consumes the same backings.
// Nothing here does I/O — it is a pure function of the type items, so it is
// exhaustively unit-testable without a database.

import {
  graphqlTypeName,
  singularQueryField,
  listQueryField,
  isValidGraphqlName,
} from './naming.ts';
import { mapProperty } from './scalars.ts';
import { applyNamingStrategy, type NamingStrategy } from './naming-strategy.ts';
import type {
  XGraphqlType,
  XGraphqlProperty,
  XGraphqlField,
  ComputedScope,
} from './vocabulary.ts';

// ─── Backing (the resolver plan) ────────────────────────────────────────────

export interface ScalarColumnBacking {
  kind: 'scalarColumn';
  /** obj_<type> column name (== jsonSchema property name). */
  column: string;
  /** True for array-of-primitives columns. */
  list: boolean;
}

export interface ReferenceBacking {
  kind: 'reference';
  targetTypeName: string;
  list: boolean;
  /** FK-column reference: the obj_<type> column holding the target's UUID. */
  column?: string;
  /** Relationship-item reference: the relationshipType to traverse. */
  relationshipType?: string;
  direction?: 'outgoing' | 'incoming';
}

export interface ContainmentBacking {
  kind: 'containment';
  targetTypeName: string;
  parentField: string;
  list: boolean;
  includeDeleted: boolean;
}

export interface ComputedBacking {
  kind: 'computed';
  /** UUID of the function/formula/query item that computes the value. */
  backedBy: string;
  scope: ComputedScope;
  list: boolean;
}

export interface IdentityBacking {
  kind: 'identity';
  /** Which item-envelope field this maps to. */
  field: 'id' | 'parentId' | 'value' | 'typeId';
}

export type Backing =
  | ScalarColumnBacking
  | ReferenceBacking
  | ContainmentBacking
  | ComputedBacking
  | IdentityBacking;

// ─── Model ──────────────────────────────────────────────────────────────────

export interface FieldModel {
  /** GraphQL field name (snake_case preserved from the property name). */
  name: string;
  /** Fully decorated GraphQL type reference, e.g. "String!", "[ChMessage!]!". */
  graphqlType: string;
  /** Undecorated target type, for cross-referencing (e.g. "ChMessage"). */
  namedType: string;
  backing: Backing;
  description?: string;
}

export interface ObjectTypeModel {
  /** GraphQL object type name (e.g. "ChThread"). */
  name: string;
  /** UUID of the source `type` item. */
  typeItemId: string;
  /** Physical storage table (obj_<uuid_with_underscores>). */
  tableName: string;
  description?: string;
  fields: FieldModel[];
  /** Singular root query field, e.g. "chThread". */
  queryName: string;
  /** List root query field, e.g. "chThreads". */
  listQueryName: string;
}

export interface Diagnostic {
  level: 'error' | 'warning';
  typeItemId?: string;
  typeName?: string;
  field?: string;
  message: string;
}

export interface SchemaModel {
  types: ObjectTypeModel[];
  /** Custom scalars actually referenced (subset of CUSTOM_SCALARS). */
  customScalars: string[];
  diagnostics: Diagnostic[];
}

export interface BuildOptions {
  /** Expose types even when they carry no `x-graphql` block. Default true — a
   *  plain type still gets a generated object type + query fields from its
   *  columns. Set false to require opt-in via `x-graphql.expose`. */
  exposeUnannotated?: boolean;
  /** Restrict the build to type items whose `item.value` is in this set (e.g.
   *  the community-hub `ch-*` types). Undefined → all provided types. */
  only?: string[];
  /** Default wire-name strategy applied to every type's canonical camelCase
   *  field names (a type's `x-graphql.fieldNaming` and a field's
   *  `x-graphql.name` override it). Defaults to 'preserve' — GraphQL keeps the
   *  canonical camelCase. Set 'snake' to emit a snake_case-contract surface. */
  fieldNaming?: NamingStrategy;
  /** Default database-column strategy (overridden by a type's
   *  `x-graphql.columnNaming` and a field's `x-graphql.column`). Defaults to
   *  'snake' — the API is camelCase, the obj_<type> columns are snake_case. */
  columnNaming?: NamingStrategy;
}

// obj_<uuid-with-hyphens-replaced-by-underscores> — mirrors the postgres adapter.
function tableNameForType(typeId: string): string {
  return `obj_${typeId.replace(/-/g, '_')}`;
}

// Renders an undecorated named type into a full GraphQL type reference.
function renderTypeRef(namedType: string, opts: { list: boolean; nonNull: boolean; listItemNonNull?: boolean }): string {
  if (opts.list) {
    const inner = `${namedType}${opts.listItemNonNull === false ? '' : '!'}`;
    return `[${inner}]${opts.nonNull ? '!' : ''}`;
  }
  return `${namedType}${opts.nonNull ? '!' : ''}`;
}

/** Build a SchemaModel from a set of `type` items. Pure — no I/O. */
export function buildSchemaModel(typeItems: any[], options: BuildOptions = {}): SchemaModel {
  const exposeUnannotated = options.exposeUnannotated ?? true;
  const diagnostics: Diagnostic[] = [];
  const usedScalars = new Set<string>();

  // First pass: decide the GraphQL type name for every type item, so references
  // and containment fields can resolve target names regardless of order.
  const selected = typeItems.filter((t) => {
    if (t?.item?.type !== 'type') return false;
    if (options.only && !options.only.includes(t.item.value)) return false;
    const xg: XGraphqlType | undefined = t.payload?.jsonSchema?.['x-graphql'];
    if (xg?.expose === false) return false;
    if (!xg && !exposeUnannotated) return false;
    return true;
  });

  const nameByTypeId = new Map<string, string>();
  const nameCollision = new Map<string, string>(); // gqlName → first typeItemId
  for (const t of selected) {
    const xg: XGraphqlType | undefined = t.payload?.jsonSchema?.['x-graphql'];
    const name = xg?.name ?? graphqlTypeName(t.item.value);
    if (nameCollision.has(name)) {
      diagnostics.push({
        level: 'error',
        typeItemId: t.item.id,
        typeName: name,
        message: `GraphQL type name "${name}" collides with type item ${nameCollision.get(name)}. Set a distinct x-graphql.name.`,
      });
      continue;
    }
    nameCollision.set(name, t.item.id);
    nameByTypeId.set(t.item.id, name);
  }

  const types: ObjectTypeModel[] = [];

  for (const t of selected) {
    const typeItemId: string = t.item.id;
    const name = nameByTypeId.get(typeItemId);
    if (!name) continue; // collided
    const xg: XGraphqlType = t.payload?.jsonSchema?.['x-graphql'] ?? {};
    const jsonSchema = t.payload?.jsonSchema ?? {};
    const properties: Record<string, any> = jsonSchema.properties ?? {};
    const required: string[] = jsonSchema.required ?? [];
    // Naming cascade: per-field override > per-type strategy > build default.
    // Canonical field names are camelCase. The WIRE strategy produces the GraphQL
    // field name (default 'preserve' → camelCase). The COLUMN strategy produces
    // the obj_<type> column name (default 'snake' → snake_case DB columns).
    const strategy: NamingStrategy = xg.fieldNaming ?? options.fieldNaming ?? 'preserve';
    const columnStrategy: NamingStrategy = xg.columnNaming ?? options.columnNaming ?? 'snake';

    const fields: FieldModel[] = [];
    const seenFieldNames = new Set<string>();

    // Every object exposes its identity. `id` is item.id (the stable UUID the
    // consumer contract keys on).
    fields.push({
      name: 'id',
      graphqlType: 'ID!',
      namedType: 'ID',
      backing: { kind: 'identity', field: 'id' },
      description: 'Item UUID.',
    });
    seenFieldNames.add('id');

    // Column-backed scalar + reference fields, from jsonSchema.properties.
    for (const [propName, propSchema] of Object.entries(properties)) {
      const px: XGraphqlProperty = propSchema?.['x-graphql'] ?? {};
      if (px.expose === false) continue;

      const fieldName = px.name ?? applyNamingStrategy(propName, strategy);
      const column = px.column ?? applyNamingStrategy(propName, columnStrategy);
      if (!isValidGraphqlName(fieldName)) {
        diagnostics.push({
          level: 'error',
          typeItemId,
          typeName: name,
          field: fieldName,
          message: `Field name "${fieldName}" is not a valid GraphQL identifier. Set x-graphql.name.`,
        });
        continue;
      }
      if (seenFieldNames.has(fieldName)) {
        diagnostics.push({
          level: 'error',
          typeItemId,
          typeName: name,
          field: fieldName,
          message: `Duplicate field "${fieldName}".`,
        });
        continue;
      }

      const mapped = mapProperty(propSchema);
      if (!mapped) {
        diagnostics.push({
          level: 'error',
          typeItemId,
          typeName: name,
          field: propName,
          message: `Property "${propName}" is not a flat shape (primitive, array-of-primitives, or typeId reference) and cannot be exposed.`,
        });
        continue;
      }

      const nonNull = required.includes(propName);

      if (mapped.kind === 'reference') {
        // FK-column reference. Resolve the target type name from its UUID; fall
        // back to a bare ID scalar if the referenced type isn't in the build.
        const targetName = px.targetType
          ?? (mapped.referenceTypeId ? nameByTypeId.get(mapped.referenceTypeId) : undefined);
        if (targetName) {
          fields.push({
            name: fieldName,
            graphqlType: renderTypeRef(targetName, { list: false, nonNull }),
            namedType: targetName,
            backing: { kind: 'reference', targetTypeName: targetName, list: false, column },
            description: propSchema.description,
          });
        } else {
          // Referenced type not exposed — surface the raw FK id rather than drop it.
          usedScalars.add('ID');
          fields.push({
            name: fieldName,
            graphqlType: renderTypeRef('ID', { list: false, nonNull }),
            namedType: 'ID',
            backing: { kind: 'scalarColumn', column, list: false },
            description: propSchema.description,
          });
          diagnostics.push({
            level: 'warning',
            typeItemId,
            typeName: name,
            field: fieldName,
            message: `Reference "${propName}" targets a type not in this build; exposed as a raw ID.`,
          });
        }
      } else {
        const gqlNamed = px.type ?? mapped.graphqlType;
        if (gqlNamed === 'DateTime' || gqlNamed === 'JSON' || gqlNamed === 'ID') usedScalars.add(gqlNamed);
        fields.push({
          name: fieldName,
          graphqlType: renderTypeRef(gqlNamed, { list: mapped.list, nonNull }),
          namedType: gqlNamed,
          backing: { kind: 'scalarColumn', column, list: mapped.list },
          description: propSchema.description,
        });
      }
      seenFieldNames.add(fieldName);
    }

    // Declared non-column fields: containment / reference / computed.
    for (const [fieldName, decl] of Object.entries<XGraphqlField>(xg.fields ?? {})) {
      if (!isValidGraphqlName(fieldName)) {
        diagnostics.push({ level: 'error', typeItemId, typeName: name, field: fieldName, message: `Field name "${fieldName}" is not a valid GraphQL identifier.` });
        continue;
      }
      if (seenFieldNames.has(fieldName)) {
        diagnostics.push({ level: 'error', typeItemId, typeName: name, field: fieldName, message: `Field "${fieldName}" collides with a column-backed field.` });
        continue;
      }
      const built = buildDeclaredField(fieldName, decl, { typeItemId, typeName: name, diagnostics, usedScalars });
      if (built) {
        fields.push(built);
        seenFieldNames.add(fieldName);
      }
    }

    types.push({
      name,
      typeItemId,
      tableName: tableNameForType(typeItemId),
      description: t.payload?.meta?.description ?? jsonSchema.description,
      fields,
      queryName: xg.queryName ?? singularQueryField(name),
      listQueryName: xg.listQueryName ?? listQueryField(name),
    });
  }

  return {
    types,
    customScalars: [...usedScalars].filter((s) => s === 'DateTime' || s === 'JSON').sort(),
    diagnostics,
  };
}

function buildDeclaredField(
  fieldName: string,
  decl: XGraphqlField,
  ctx: { typeItemId: string; typeName: string; diagnostics: Diagnostic[]; usedScalars: Set<string> },
): FieldModel | null {
  const list = decl.list ?? false;
  switch (decl.kind) {
    case 'containment': {
      // Contained children are always a present (possibly empty) collection when
      // list; a single containment is nullable.
      return {
        name: fieldName,
        graphqlType: renderTypeRef(decl.type, { list, nonNull: list }),
        namedType: decl.type,
        backing: {
          kind: 'containment',
          targetTypeName: decl.type,
          parentField: decl.parentField ?? 'parentId',
          list,
          includeDeleted: decl.includeDeleted ?? false,
        },
      };
    }
    case 'reference': {
      return {
        name: fieldName,
        graphqlType: renderTypeRef(decl.type, { list, nonNull: false }),
        namedType: decl.type,
        backing: {
          kind: 'reference',
          targetTypeName: decl.type,
          list,
          relationshipType: decl.relationshipType,
          direction: decl.direction ?? 'outgoing',
        },
      };
    }
    case 'computed': {
      if (decl.type === 'DateTime' || decl.type === 'JSON') ctx.usedScalars.add(decl.type);
      return {
        name: fieldName,
        graphqlType: renderTypeRef(decl.type, { list, nonNull: false }),
        namedType: decl.type,
        backing: { kind: 'computed', backedBy: decl.backedBy, scope: decl.scope ?? 'shared', list },
      };
    }
    default: {
      ctx.diagnostics.push({
        level: 'error',
        typeItemId: ctx.typeItemId,
        typeName: ctx.typeName,
        field: fieldName,
        message: `Unknown x-graphql field kind "${(decl as any).kind}".`,
      });
      return null;
    }
  }
}
