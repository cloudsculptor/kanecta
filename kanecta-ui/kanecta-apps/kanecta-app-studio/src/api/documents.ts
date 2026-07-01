import type {
  KanectaApiClient,
  DocumentItem,
  DocumentPayload,
  CreateDocumentPayload,
} from '@kanecta/api-client';

export type { DocumentItem, DocumentPayload, DocumentMode, CreateDocumentPayload } from '@kanecta/api-client';

// Reach the underlying transport directly (like workingSets.ts): the pre-bundled
// api-client may not yet expose the `documents` accessor, but `_fetch` is always
// present, so this avoids a dev-server dep re-optimisation.
interface RawFetchClient {
  _fetch: (method: string, path: string, body?: unknown) => Promise<unknown>;
}

export function documentsApi(client: KanectaApiClient) {
  const raw = client as unknown as RawFetchClient;
  const enc = encodeURIComponent;
  return {
    listForTarget: (targetId: string) =>
      raw._fetch('GET', `/items/${enc(targetId)}/documents`) as Promise<DocumentItem[]>,
    create: (targetId: string, payload: CreateDocumentPayload) =>
      raw._fetch('POST', `/items/${enc(targetId)}/documents`, payload) as Promise<DocumentItem>,
    get: (docId: string) => raw._fetch('GET', `/documents/${enc(docId)}`) as Promise<DocumentPayload>,
    update: (docId: string, payload: DocumentPayload) =>
      raw._fetch('PUT', `/documents/${enc(docId)}`, payload) as Promise<{ ok: boolean }>,
  };
}
