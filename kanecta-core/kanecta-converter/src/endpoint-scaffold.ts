// endpoint-scaffold — Gate 2's generator.
//
// Turns a source REST route into the Kanecta item that reproduces it, and — where
// it can't be pure data — flags it with a punch-list line. This is the determinism
// boundary made concrete (spec §"automate the ~80%, flag the ~20%"):
//
//   * a PURE READ (GET, no side-effects, no non-data integration) → a `query`
//     item. queryPayload carries the SELECT (or a native `kanecta` filter) plus the
//     path params. A single-type filter sets `returnType`; a derived/assembled shape
//     (join/aggregate/nested projection — e.g. message + files + reply_count) is a
//     query with `returnType: null`, exactly as the query spec prescribes.
//   * a WRITE, a read WITH SIDE-EFFECTS (GET /threads seeds thread_reads!), or a
//     NON-DATA INTEGRATION (Keycloak admin proxy, push) → a `function` stub + a
//     punch-list line. The converter never fakes the hard 20% as data.
//
// Deterministic and pure: same endpoint descriptor → same item (UUIDv5 ids). The
// Kanecta `view` type is a UI renderer-binding, not a data projection, so it is
// deliberately NOT a target here — a derived read is a `query` with a null returnType.

import { deterministicUuid } from './introspect.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface SourceEndpoint {
  method: HttpMethod;
  /** Route path, params as `:name`, e.g. "/threads/:id/messages". */
  path: string;
  description?: string;
  /** The route's read SQL, when it is a SELECT. Emitted verbatim as the query
   *  expression (params bound as {{params.name}} — never string-interpolated). */
  sql?: string;
  /** Declared side-effects (socket emits, timestamp bumps, notifications, file
   *  attach, read-seeding). Any → not a pure read → a function. */
  sideEffects?: string[];
  /** A non-data integration this route proxies (e.g. 'keycloak', 'push',
   *  'external'). Any → an app-layer shim, never item-CRUD. */
  integration?: string;
  /** True when the response is a derived/assembled shape (join/aggregate/nested
   *  projection) rather than a single item type — sets the query returnType to null. */
  derived?: boolean;
  /** The `item.value` of the Kanecta type the response maps to, for a single-type
   *  read — resolved to the same deterministic type UUID introspect mints. */
  returnTypeValue?: string;
}

export type EndpointClass = 'query' | 'function';

export interface ScaffoldResult {
  endpoint: string; // "GET /threads"
  classification: EndpointClass;
  determinism: 'deterministic' | 'needs-judgment';
  reason: string;
  /** The generated Kanecta `query` item, or a `function` stub for the 20%. */
  item: any;
  /** Present when human work is required — the precise punch-list line. */
  punchList?: string;
}

const ROOT_UUID = '00000000-0000-0000-0000-000000000000';

/** `:id`, `:threadId` … in declaration order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

function endpointTypeId(value: string): string {
  return deterministicUuid(`kanecta-converter:type:${value}`);
}

function envelope(id: string, type: 'query' | 'function', value: string) {
  return { id, parentId: ROOT_UUID, type, typeId: null, value, sortOrder: null };
}
function meta(description: string) {
  return { specVersion: '1.4.0', owner: 'kanecta', visibility: 'public', tags: ['converted', 'endpoint'], description };
}

function queryItem(id: string, ep: SourceEndpoint, sig: string, params: any[]): any {
  const language = ep.sql ? 'sql' : 'kanecta';
  const expression = ep.sql ?? `# derive: ${sig} — a ${ep.derived ? 'derived/assembled' : 'single-type'} read`;
  return {
    item: envelope(id, 'query', sig),
    meta: meta(ep.description ?? `Reproduces ${sig}.`),
    search: null,
    payload: {
      language,
      expression,
      params: params.length ? params : null,
      // Single-type read → returnType is the mapped type; derived shape → null.
      returnType: !ep.derived && ep.returnTypeValue ? endpointTypeId(ep.returnTypeValue) : null,
      description: ep.description ?? `Converted from ${sig}.`,
    },
  };
}

function functionStub(id: string, ep: SourceEndpoint, sig: string, params: any[]): any {
  return {
    item: envelope(id, 'function', sig),
    meta: meta(ep.description ?? `App-shim for ${sig}.`),
    search: null,
    payload: {
      runtime: 'typescript',
      parameters: params,
      // A scaffold, not a finished function — the human fills the body. Marked so
      // it can't be mistaken for a generated, ready-to-run function.
      scaffold: true,
      description: ep.description ?? `Converted from ${sig} — requires implementation.`,
    },
  };
}

/** Classify + scaffold one source endpoint. */
export function scaffoldEndpoint(ep: SourceEndpoint): ScaffoldResult {
  const sig = `${ep.method} ${ep.path}`;
  const id = deterministicUuid(`kanecta-converter:endpoint:${sig}`);
  const params = pathParams(ep.path).map((name) => ({ name, type: 'uuid', description: `path param :${name}` }));
  const hasSideEffects = (ep.sideEffects?.length ?? 0) > 0;
  const isWrite = ep.method !== 'GET';

  // 1) Non-data integration → an app-layer shim (never item-CRUD).
  if (ep.integration) {
    return {
      endpoint: sig, classification: 'function', determinism: 'needs-judgment',
      reason: `non-data integration (${ep.integration}) — stays an app-layer shim, not item-CRUD`,
      punchList: `${sig}: app-shim to ${ep.integration}; not expressible as a query.`,
      item: functionStub(id, ep, sig, params),
    };
  }
  // 2) Writes, or reads with side-effects → a function + a punch-list line.
  if (isWrite || hasSideEffects) {
    const why = isWrite ? `${ep.method} write` : 'read with side-effects';
    const fx = hasSideEffects ? ` — side-effects: ${ep.sideEffects!.join(', ')}` : '';
    return {
      endpoint: sig, classification: 'function', determinism: 'needs-judgment',
      reason: `${why}${fx} — needs a function item`,
      punchList: `${sig}: ${why}${fx}.`,
      item: functionStub(id, ep, sig, params),
    };
  }
  // 3) Pure read → a query item (deterministic).
  return {
    endpoint: sig, classification: 'query', determinism: 'deterministic',
    reason: ep.derived
      ? 'pure read, derived/assembled shape → a query item (returnType null)'
      : 'pure read (SELECT … WHERE) → a single-type query item',
    item: queryItem(id, ep, sig, params),
  };
}

export interface ScaffoldSummary {
  results: ScaffoldResult[];
  counts: { query: number; function: number; deterministic: number; needsJudgment: number };
  /** The precise ~20% a human must implement. */
  punchList: string[];
}

/** Scaffold a whole route table and roll up the determinism split + punch-list. */
export function scaffoldEndpoints(endpoints: SourceEndpoint[]): ScaffoldSummary {
  const results = endpoints.map(scaffoldEndpoint);
  const counts = { query: 0, function: 0, deterministic: 0, needsJudgment: 0 };
  const punchList: string[] = [];
  for (const r of results) {
    counts[r.classification]++;
    if (r.determinism === 'deterministic') counts.deterministic++; else counts.needsJudgment++;
    if (r.punchList) punchList.push(r.punchList);
  }
  return { results, counts, punchList };
}
