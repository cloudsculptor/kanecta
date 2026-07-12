// response-diff — Gate 2's validity check.
//
// The cutover promise for a read endpoint is "Kanecta serves byte-for-byte the
// same JSON the old route served." This tool proves (or disproves) that: given the
// OLD response and the Kanecta-SERVED response for the same request, it walks both
// structurally and reports every difference — missing/extra keys, type mismatches
// (a string "3" is NOT the number 3 — the discussions contract deliberately returns
// pg COUNT as a string), value mismatches, and array length/order deltas.
//
// Pure and deterministic (no I/O), like schema-diff: the caller fetches the two
// responses; this only compares. A small options set expresses the *intended*
// deltas of a compat surface (a snake↔camel rename, a volatile signed-URL field,
// null-vs-absent) so genuine divergences aren't drowned out — anything not opted
// in as expected is a divergence.

export interface ResponseDiffOptions {
  /** Old-key → new-key renames applied at any depth (e.g. a snake→camel compat
   *  surface). A renamed pair is compared as the same field. */
  keyRenames?: Record<string, string>;
  /** Key names (at any depth) to skip entirely — for genuinely volatile fields
   *  (a freshly signed URL, a server clock echo). Use sparingly; each one is a
   *  hole in the parity guarantee and is reported in `ignoredKeys`. */
  ignoreKeys?: string[];
  /** Treat a missing key and an explicit null as equal (some serializers omit
   *  nulls). Default false — absence ≠ null under byte-for-byte. */
  nullEqualsAbsent?: boolean;
  /** Compare arrays at these paths (or the special value '*') as multisets rather
   *  than positionally — for endpoints whose order is unspecified. Default: all
   *  arrays are ordered (byte-for-byte). */
  unorderedArrayPaths?: string[];
  /** Keys (at any depth) whose value/type difference is downgraded to a
   *  known-nuance instead of a divergence (a documented, accepted delta). */
  knownNuanceKeys?: string[];
}

export type ResponseDiffKind =
  | 'missing'         // present in old, absent in new (fidelity loss)
  | 'extra'           // present in new, absent in old (contract drift)
  | 'type-mismatch'   // same key, different JSON type (incl. string "3" vs 3)
  | 'value-mismatch'  // same type, different value
  | 'array-length'    // arrays differ in length
  | 'known-nuance';   // an opted-in, expected delta

export interface ResponseDiffEntry {
  /** JSON path, e.g. `threads[0].createdAt` or `["<msgId>"][0].count`. */
  path: string;
  kind: ResponseDiffKind;
  detail?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ResponseDiffReport {
  /** 'parity' when there is no divergence (nuances allowed); else 'divergent'. */
  verdict: 'parity' | 'divergent';
  /** Every non-matching observation (divergences + nuances), in walk order. */
  entries: ResponseDiffEntry[];
  divergences: ResponseDiffEntry[];
  nuances: ResponseDiffEntry[];
  /** Keys skipped via ignoreKeys (each a hole in the guarantee — surfaced, not hidden). */
  ignoredKeys: string[];
  counts: { matched: number; divergences: number; nuances: number };
}

function jsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Compare an old response against a Kanecta-served response. */
export function diffResponses(oldResp: unknown, newResp: unknown, opts: ResponseDiffOptions = {}): ResponseDiffReport {
  const renames = opts.keyRenames ?? {};
  const ignore = new Set(opts.ignoreKeys ?? []);
  const nuanceKeys = new Set(opts.knownNuanceKeys ?? []);
  const unordered = new Set(opts.unorderedArrayPaths ?? []);
  const entries: ResponseDiffEntry[] = [];
  const ignoredKeys = new Set<string>();
  let matched = 0;

  const push = (e: ResponseDiffEntry, key?: string) => {
    // A value/type difference on a known-nuance key is downgraded.
    if (key && nuanceKeys.has(key) && (e.kind === 'value-mismatch' || e.kind === 'type-mismatch' || e.kind === 'missing' || e.kind === 'extra')) {
      entries.push({ ...e, kind: 'known-nuance', detail: `${e.kind}: ${e.detail ?? ''}`.trim() });
    } else {
      entries.push(e);
    }
  };

  const unorderedAt = (path: string) => unordered.has('*') || unordered.has(path);

  function walk(oldV: unknown, newV: unknown, path: string, key?: string): void {
    const ot = jsonType(oldV);
    const nt = jsonType(newV);

    if (ot !== nt) {
      // null-vs-absent is handled by the caller (key loop); here both exist.
      push({ path, kind: 'type-mismatch', detail: `${ot} ≠ ${nt}`, oldValue: oldV, newValue: newV }, key);
      return;
    }

    if (isObject(oldV) && isObject(newV)) {
      const oldKeys = Object.keys(oldV);
      const seenNew = new Set<string>();
      for (const k of oldKeys) {
        if (ignore.has(k)) { ignoredKeys.add(k); continue; }
        const nk = renames[k] ?? k;
        seenNew.add(nk);
        const childPath = path ? `${path}.${k}` : k;
        const hasNew = Object.prototype.hasOwnProperty.call(newV, nk);
        if (!hasNew) {
          if (opts.nullEqualsAbsent && oldV[k] === null) { matched++; continue; }
          push({ path: childPath, kind: 'missing', detail: `key "${nk}" absent in new`, oldValue: oldV[k] }, k);
          continue;
        }
        walk(oldV[k], (newV as any)[nk], childPath, k);
      }
      // Extra keys in new that no old key mapped to.
      for (const k of Object.keys(newV)) {
        if (ignore.has(k)) { ignoredKeys.add(k); continue; }
        if (seenNew.has(k)) continue;
        if (opts.nullEqualsAbsent && (newV as any)[k] === null) { matched++; continue; }
        push({ path: path ? `${path}.${k}` : k, kind: 'extra', detail: `key "${k}" absent in old`, newValue: (newV as any)[k] }, k);
      }
      return;
    }

    if (Array.isArray(oldV) && Array.isArray(newV)) {
      if (oldV.length !== newV.length) {
        push({ path, kind: 'array-length', detail: `${oldV.length} ≠ ${newV.length}`, oldValue: oldV.length, newValue: newV.length }, key);
        // still compare the common prefix so field-level diffs surface too
      }
      if (unorderedAt(path)) {
        // Multiset compare by canonical JSON — order-insensitive.
        const norm = (x: unknown) => stableStringify(x);
        const newBag = new Map<string, number>();
        for (const el of newV) newBag.set(norm(el), (newBag.get(norm(el)) ?? 0) + 1);
        for (let i = 0; i < oldV.length; i++) {
          const kk = norm(oldV[i]);
          const c = newBag.get(kk) ?? 0;
          if (c > 0) { newBag.set(kk, c - 1); matched++; }
          else push({ path: `${path}[${i}]`, kind: 'missing', detail: 'element not found in new (unordered)', oldValue: oldV[i] }, key);
        }
        return;
      }
      const n = Math.min(oldV.length, newV.length);
      for (let i = 0; i < n; i++) walk(oldV[i], newV[i], `${path}[${i}]`, key);
      return;
    }

    // Primitives (same JSON type).
    if (oldV === newV) { matched++; return; }
    push({ path, kind: 'value-mismatch', detail: `${JSON.stringify(oldV)} ≠ ${JSON.stringify(newV)}`, oldValue: oldV, newValue: newV }, key);
  }

  walk(oldResp, newResp, '');

  const divergences = entries.filter((e) => e.kind !== 'known-nuance');
  const nuances = entries.filter((e) => e.kind === 'known-nuance');
  return {
    verdict: divergences.length === 0 ? 'parity' : 'divergent',
    entries,
    divergences,
    nuances,
    ignoredKeys: [...ignoredKeys],
    counts: { matched, divergences: divergences.length, nuances: nuances.length },
  };
}

/** Deterministic JSON with sorted object keys — for multiset array comparison. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
