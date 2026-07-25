// Recognise the file-item UUID inside an embedded file/image URL, for every URL
// shape the app has ever emitted into page content:
//
//   1. Spaces CDN, sharded key:  ${SPACES_PUBLIC_URL}/aa/bb/<uuid>
//   2. Spaces CDN, flat key:     ${SPACES_PUBLIC_URL}/<uuid>          (pre-shard prod)
//   3. Community-hub file proxy: ${KANECTA_FILE_URL_BASE}/<uuid>
//   4. Raw kanecta-api endpoint: ${KANECTA_API_URL}/items/<uuid>/files/blob[?mime=…]
//
// Callers (page image soft-delete, site download bundling) act on the extracted
// id — so extraction is deliberately gated on the app's own URL prefixes; a UUID
// inside some third-party image URL must never be treated as one of our files.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function knownPrefixes() {
  // Read at call time (not import) so tests and late-configured envs behave.
  return [
    process.env.SPACES_PUBLIC_URL,
    process.env.KANECTA_FILE_URL_BASE,
    process.env.KANECTA_API_URL,
  ].filter(Boolean);
}

/** File-item UUID from an app-emitted file URL, or null for foreign/opaque URLs. */
export function fileIdFromUrl(src) {
  if (typeof src !== "string" || !src) return null;
  const prefix = knownPrefixes().find((p) => src.startsWith(p + "/") || src === p);
  if (!prefix) return null;
  const path = src.slice(prefix.length).split(/[?#]/)[0];
  // First UUID-shaped path segment wins — covers sharded (aa/bb/<uuid>), flat
  // (<uuid>), proxy (<uuid>) and raw (items/<uuid>/files/blob) layouts alike.
  for (const seg of path.split("/")) {
    if (UUID_RE.test(seg) && seg.match(UUID_RE)[0] === seg) return seg.toLowerCase();
  }
  return null;
}
