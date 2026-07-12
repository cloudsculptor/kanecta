// The `x-graphql` vocabulary — how a `type` item declares its GraphQL-exposed
// surface, entirely as DATA.
//
// This is the "design task" from the community-hub → kanecta-api cutover plan
// (plans/community-hub-cutover-sprint.md §"API surface"): the vocabulary by
// which a type item says which of its fields GraphQL exposes, what each field's
// GraphQL type is, and — for non-column fields — what backs it (a related item,
// contained children, or a computed function/formula/query item).
//
// CRITICAL DESIGN CONSTRAINT — this vocabulary is PURELY ADDITIVE and requires
// NO change to the Kanecta specification:
//   * `x-graphql` is a JSON-Schema *extension keyword* (the `x-` convention the
//     spec already uses for `x-id`). Standard validators ignore unknown keywords,
//     so instances still validate.
//   * The item schema (specification 1.4.0, core-file-specs/item.json,
//     definitions.typePayload) does NOT set `additionalProperties:false` on the
//     `jsonSchema` object, nor on the individual entries of `jsonSchema.properties`.
//     So `x-graphql` is legal at both the schema root and per-property TODAY.
//   * Nothing here is written into a spec file. Spec-writing for 1.5.0 stays
//     deferred and approval-gated (see plans + the spec-human-approval rule);
//     this module is the *engine* that reads the vocabulary, not the spec.
//
// A type item therefore looks like (abbreviated):
//
//   payload.jsonSchema = {
//     "$schema": "...", "title": "ChThread", "type": "object",
//     "x-graphql": {
//       "name": "ChThread",
//       "fields": {
//         "messages":    { "kind": "containment", "type": "ChMessage", "list": true },
//         "reply_count": { "kind": "computed", "type": "Int", "backedBy": "<uuid>" }
//       }
//     },
//     "properties": {
//       "name":       { "x-id": "...", "type": "string" },
//       "created_at": { "x-id": "...", "type": "string", "format": "date-time",
//                       "x-graphql": { "type": "DateTime" } },
//       "internal":   { "x-id": "...", "type": "string", "x-graphql": { "expose": false } }
//     }
//   }

import type { NamingStrategy } from './naming-strategy.ts';

/** How a computed field's per-viewer-ness is declared. Per-viewer fields (e.g.
 *  `hasUnread`, `isNotificationsEnabled`) depend on the requesting principal
 *  and cannot be cached across viewers. */
export type ComputedScope = 'shared' | 'perViewer';

/** Root-level `x-graphql` block, living at `payload.jsonSchema["x-graphql"]`. */
export interface XGraphqlType {
  /** GraphQL object type name. Defaults to a PascalCase form of the type item's
   *  `item.value` (e.g. "ch-thread" → "ChThread"). */
  name?: string;
  /** Whether this type is exposed on the GraphQL surface at all. Defaults to
   *  true. Set false to keep a type storage-only (no query fields, no object
   *  type emitted). */
  expose?: boolean;
  /** Non-column fields: relationships, contained children, and computed fields.
   *  Column-backed scalar/reference fields are declared by the ordinary
   *  jsonSchema `properties` and need no entry here. */
  fields?: Record<string, XGraphqlField>;
  /** Override for the singular root query field name (default: lower-camel of
   *  `name`, e.g. "chThread"). */
  queryName?: string;
  /** Override for the list root query field name (default: a naive plural of
   *  `queryName`, e.g. "chThreads"). */
  listQueryName?: string;
  /** Wire-name strategy for THIS type's fields, applied to the canonical
   *  camelCase field names (a per-field `x-graphql.name` still wins). Use
   *  'snake' when the type must speak a foreign snake_case contract (e.g. a
   *  transient legacy-REST compat projection during cutover). Defaults to the
   *  build-level strategy, then 'preserve' — the canonical surface is camelCase.
   *  Note: DB columns are ALWAYS snake_case (see the spec, not configurable). */
  fieldNaming?: NamingStrategy;
}

/** Per-property `x-graphql` block, living at
 *  `payload.jsonSchema.properties.<field>["x-graphql"]`. Refines how a stored
 *  column is projected into GraphQL. */
export interface XGraphqlProperty {
  /** Force an exact wire field name, bypassing the naming strategy entirely —
   *  the equivalent of Jackson's `@JsonProperty("...")`. Canonical type fields
   *  are camelCase; set this only when a field must carry a specific external
   *  name the strategy would not produce. Default: the strategy applied to the
   *  canonical (camelCase) property name. */
  name?: string;
  /** Hide this column from GraphQL while keeping it in storage. Default true
   *  (exposed). */
  expose?: boolean;
  /** Override the derived GraphQL scalar (e.g. force "DateTime" or "ID"). When
   *  absent the scalar is inferred from the property's JSON-Schema type/format. */
  type?: string;
  /** For `format:uuid` + `typeId` reference columns: the GraphQL object type the
   *  reference resolves to. Defaults to the referenced type's derived name. */
  targetType?: string;
}

/** A non-column field declared under `x-graphql.fields`. */
export type XGraphqlField =
  | XGraphqlContainmentField
  | XGraphqlReferenceField
  | XGraphqlComputedField;

/** Children of this item in the tree (by `parentId`), optionally narrowed to a
 *  target type. Maps discussions' thread→messages and message→replies. */
export interface XGraphqlContainmentField {
  kind: 'containment';
  /** GraphQL object type of the children. */
  type: string;
  /** True → `[Type!]!`; false/absent → a single `Type`. */
  list?: boolean;
  /** Parent linkage field on the child (default `parentId`). Reserved for
   *  non-default containment; community-hub uses the default. */
  parentField?: string;
  /** Whether to include soft-deleted children. Default false. */
  includeDeleted?: boolean;
}

/** An explicit relationship to another item, resolved via `relationship` items
 *  (not a stored FK column — that is an ordinary reference property instead). */
export interface XGraphqlReferenceField {
  kind: 'reference';
  /** GraphQL object type this reference resolves to. */
  type: string;
  /** True → a list of targets. */
  list?: boolean;
  /** The `relationship.relationshipType` to traverse (e.g. "attaches"). */
  relationshipType: string;
  /** Traverse from this item as source (default) or as target. */
  direction?: 'outgoing' | 'incoming';
}

/** A field whose value is produced by running a `function` / `formula` / `query`
 *  item — never by hand-written per-domain resolver code. */
export interface XGraphqlComputedField {
  kind: 'computed';
  /** GraphQL type of the computed value (scalar or object type name; append `!`
   *  / wrap `[]` via `list`). */
  type: string;
  /** True → the value is a list. */
  list?: boolean;
  /** UUID of the `function` / `formula` / `query` item that computes the value.
   *  The generic engine executes it via the runner; no bespoke code. */
  backedBy: string;
  /** Whether the value depends on the requesting principal. Per-viewer fields
   *  (has_unread, is_notifications_enabled) get the viewer in scope and are not
   *  shared-cacheable. Default 'shared'. */
  scope?: ComputedScope;
}
