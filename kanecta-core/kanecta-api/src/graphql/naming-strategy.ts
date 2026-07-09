// Field naming strategy — canonical vs. wire names, with per-field override.
//
// PRINCIPLE (owner directive): type items are authored in standard JSON
// **camelCase** — that is the canonical field name, and GraphQL (also camelCase-
// idiomatic) exposes it as-is by default. When a consumer needs a different wire
// casing (e.g. the legacy community-hub REST contract is snake_case), the type
// system TRANSLATES automatically via a naming strategy, and any field can be
// force-named via an explicit override. This mirrors Jackson/Spring: a global
// PropertyNamingStrategy (auto) plus @JsonProperty (per-field override).
//
// The cascade (highest priority first):
//   1. per-field override   — x-graphql.name on the property
//   2. per-type strategy     — x-graphql.fieldNaming on the type
//   3. build-default strategy — BuildOptions.fieldNaming
//   4. 'preserve'            — canonical camelCase unchanged (GraphQL default)

export type NamingStrategy = 'preserve' | 'snake' | 'camel';

/** camelCase → snake_case. "createdByUserId" → "created_by_user_id".
 *  Consecutive capitals are treated as word boundaries at each capital, which is
 *  sufficient for the domain field names in play (userId → user_id). */
export function camelToSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/** snake_case → camelCase. "created_by_user_id" → "createdByUserId". Leading and
 *  trailing underscores are preserved. */
export function snakeToCamel(name: string): string {
  return name.replace(/([^_])_+([a-z0-9])/g, (_m, a, b) => `${a}${b.toUpperCase()}`);
}

/** Apply a naming strategy to a canonical (camelCase) field name to produce the
 *  wire name. A per-field override, when present, bypasses this entirely. */
export function applyNamingStrategy(canonical: string, strategy: NamingStrategy): string {
  switch (strategy) {
    case 'snake':
      return camelToSnake(canonical);
    case 'camel':
      return snakeToCamel(canonical);
    case 'preserve':
    default:
      return canonical;
  }
}
