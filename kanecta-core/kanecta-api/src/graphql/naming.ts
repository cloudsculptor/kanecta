// Pure naming helpers for the type-items → GraphQL engine.
//
// GraphQL identifiers must match /^[_A-Za-z][_0-9A-Za-z]*$/. Type item values
// like "ch-thread" contain hyphens and must be transformed into valid PascalCase
// GraphQL type names ("ChThread"). Field names, by contrast, are preserved
// VERBATIM wherever possible — the community-hub consumer contract is snake_case
// and the projection must match byte-for-byte (GraphQL permits snake_case field
// names, so no camelCasing is applied to fields).

/** "ch-thread" → "ChThread"; "finance_report" → "FinanceReport"; "Person" →
 *  "Person". Splits on any run of non-alphanumeric characters, capitalises each
 *  part, and guarantees a leading letter (prefixing "T" if the result would
 *  start with a digit or be empty). */
export function graphqlTypeName(value: string): string {
  const parts = String(value).split(/[^0-9A-Za-z]+/).filter(Boolean);
  let name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  if (name === '' || /^[0-9]/.test(name)) name = 'T' + name;
  return name;
}

/** Lower-camel the first character of a GraphQL type name for use as the
 *  singular root query field: "ChThread" → "chThread". */
export function singularQueryField(typeName: string): string {
  return typeName.charAt(0).toLowerCase() + typeName.slice(1);
}

/** Naive English pluralisation, sufficient for query field names. Callers may
 *  override via `x-graphql.listQueryName`. */
export function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es';
  return word + 's';
}

/** List root query field: "ChThread" → "chThreads". */
export function listQueryField(typeName: string): string {
  return pluralize(singularQueryField(typeName));
}

/** True if `s` is already a valid GraphQL identifier and needs no rewriting.
 *  Used to keep snake_case field names untouched. */
export function isValidGraphqlName(s: string): boolean {
  return /^[_A-Za-z][_0-9A-Za-z]*$/.test(s);
}
