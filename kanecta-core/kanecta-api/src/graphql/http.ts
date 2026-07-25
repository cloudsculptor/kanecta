// graphql-js wiring — turns the generic engine into an executable GraphQL schema
// and an HTTP handler. This is the "feed emitSDL to buildSchema, map resolvers
// from the model, expose a /graphql route" step from the engine README.
//
// The bridge is deliberately thin because the Executor already does all the work:
//   * emitSDL(model) → buildSchema → a GraphQLSchema with NO resolvers.
//   * We attach a resolver to each ROOT query field only. It converts the
//     graphql-js resolve-info selection set into the engine's Selection tree and
//     calls Executor.resolveById / resolveList, which returns a fully-projected
//     plain object keyed by wire (GraphQL) field name.
//   * Nested fields need no resolvers: graphql-js's default field resolver reads
//     source[fieldName] off those projected objects, and it handles aliases and
//     fragments for free — so the whole recursive shape resolves itself.
//
// Computed fields still run through DataSource.runComputed; selecting one on a
// DataSource that hasn't wired the runner surfaces that error as a GraphQL error
// (honest), while every non-computed field resolves normally.

import { buildSchema, graphql, Kind } from 'graphql';
import type {
  GraphQLSchema,
  GraphQLResolveInfo,
  SelectionSetNode,
  FragmentDefinitionNode,
  ExecutionResult,
} from 'graphql';
import { allTypes } from '@kanecta/specification';
import { emitSDL } from './sdl.ts';
import { Executor } from './execute.ts';
import type { DataSource, ExecContext, Selection } from './execute.ts';
import type { SchemaModel } from './model.ts';

export interface GraphqlEngine {
  schema: GraphQLSchema;
  executor: Executor;
  /** The SDL the schema was built from (introspection/GraphiQL/debugging). */
  sdl: string;
  /** Execute one operation. Thin wrapper over graphql-js `graphql()`. */
  execute(args: {
    source: string;
    variableValues?: Record<string, unknown> | null;
    operationName?: string | null;
    context?: ExecContext;
  }): Promise<ExecutionResult>;
}

/** Build an executable GraphQL engine from a SchemaModel + a DataSource. */
export function buildGraphqlEngine(model: SchemaModel, ds: DataSource): GraphqlEngine {
  const sdl = emitSDL(model);
  const schema = buildSchema(sdl);
  const executor = new Executor(model, ds);

  const queryType = schema.getQueryType();
  if (!queryType) throw new Error('Generated GraphQL schema has no Query type');
  const fields = queryType.getFields();

  for (const type of model.types) {
    const single = fields[type.queryName];
    if (single) {
      single.resolve = (_src, args, ctx: ExecContext | undefined, info) =>
        executor.resolveById(type.name, String(args.id), selectionFromInfo(info), ctx ?? {});
    }
    const list = fields[type.listQueryName];
    if (list) {
      list.resolve = (_src, args, ctx: ExecContext | undefined, info) =>
        executor.resolveList(
          type.name,
          { where: args.where, sort: args.sort, limit: args.limit, offset: args.offset },
          selectionFromInfo(info),
          ctx ?? {},
        );
    }
  }

  return {
    schema,
    executor,
    sdl,
    execute: ({ source, variableValues, operationName, context }) =>
      graphql({
        schema,
        source,
        variableValues: variableValues ?? undefined,
        operationName: operationName ?? undefined,
        contextValue: context ?? {},
      }),
  };
}

/** Convert a graphql-js resolve-info selection set into the engine's Selection
 *  tree (field name → true | nested Selection). Aliases collapse to the real
 *  field name (graphql-js re-applies aliases on output); fragments are expanded;
 *  introspection meta fields (`__typename`, …) are skipped. */
export function selectionFromInfo(info: GraphQLResolveInfo): Selection {
  const out: Selection = {};
  for (const node of info.fieldNodes) {
    if (node.selectionSet) mergeSelectionSet(out, node.selectionSet, info.fragments);
  }
  return out;
}

function mergeSelectionSet(
  into: Selection,
  set: SelectionSetNode,
  fragments: Record<string, FragmentDefinitionNode>,
): void {
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      const name = sel.name.value;
      if (name.startsWith('__')) continue; // __typename / introspection — graphql-js handles it
      if (sel.selectionSet) {
        const existing = into[name];
        const child: Selection = existing && existing !== true ? existing : {};
        mergeSelectionSet(child, sel.selectionSet, fragments);
        into[name] = child;
      } else if (into[name] === undefined) {
        into[name] = true;
      }
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      if (sel.selectionSet) mergeSelectionSet(into, sel.selectionSet, fragments);
    } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const frag = fragments[sel.name.value];
      if (frag) mergeSelectionSet(into, frag.selectionSet, fragments);
    }
  }
}

// ─── Express plumbing ──────────────────────────────────────────────────────────

/** Load a datastore's `type` items in the shape buildSchemaModel expects
 *  (`{ item: { id, type:'type', value }, payload: { jsonSchema, … } }`).
 *  `readTypeJson` returns the payload; we wrap it with a minimal item envelope. */
// Built-in type names (primitive + structured + well-known) never become GraphQL
// query roots: they are infrastructure (object/function/query/view/…), not user
// data collections, and their naive plural collides with same-stem user types —
// e.g. the built-in `file` type's list field `files` clashes with a user `files`
// type's singular field, and `licence` with `licences`. Excluding them keeps the
// generated schema to the user's own data types (the only ones with real obj_
// tables worth querying) and makes it collision-free on any datastore.
const BUILT_IN_TYPE_NAMES = new Set<string>(allTypes as string[]);

export async function loadTypeItems(ds: {
  listTypeDefs(): Promise<any[]>;
  readTypeJson(id: string): Promise<any>;
}): Promise<any[]> {
  const defs = await ds.listTypeDefs();
  const out: any[] = [];
  for (const def of defs) {
    if (BUILT_IN_TYPE_NAMES.has(def.value)) continue;
    const payload = await ds.readTypeJson(def.id).catch(() => null);
    if (!payload?.jsonSchema) continue;
    out.push({ item: { id: def.id, type: 'type', value: def.value }, payload });
  }
  return out;
}

export interface GraphqlHandlerOptions {
  /** Resolve the engine for a request (build/lookup per working set). */
  engineFor: (req: any) => Promise<GraphqlEngine | null> | GraphqlEngine | null;
  /** Build the per-request execution context (viewer + authorize gate). */
  contextFor?: (req: any) => ExecContext | Promise<ExecContext>;
}

/** An Express POST handler implementing the standard GraphQL-over-HTTP body
 *  `{ query, variables, operationName }`. */
export function graphqlHandler(opts: GraphqlHandlerOptions) {
  return async (req: any, res: any) => {
    const { query, variables, operationName } = req.body ?? {};
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ errors: [{ message: 'A GraphQL "query" string is required' }] });
    }
    let engine: GraphqlEngine | null;
    try {
      engine = await opts.engineFor(req);
    } catch (err: any) {
      return res.status(503).json({ errors: [{ message: err?.message ?? String(err) }] });
    }
    if (!engine) {
      return res.status(501).json({ errors: [{ message: 'GraphQL is only available on a Postgres-backed working set' }] });
    }
    try {
      const context = opts.contextFor ? await opts.contextFor(req) : {};
      const result = await engine.execute({ source: query, variableValues: variables, operationName, context });
      // GraphQL-over-HTTP: a well-formed request returns 200 even with field errors.
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ errors: [{ message: err?.message ?? String(err) }] });
    }
  };
}
