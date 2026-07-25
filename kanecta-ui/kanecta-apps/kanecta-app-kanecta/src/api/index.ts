import { createApiClient, ApiError } from '@kanecta/api-client';
import keycloak from '../auth/keycloak';

export { ApiError };

// `keycloak.token` is undefined when unauthenticated or when auth is
// disabled (VITE_AUTH_DISABLED=true) — the client then sends no
// Authorization header, matching the backend's AUTH_DISABLED bypass.
// Read it lazily (not just once) since KeycloakProvider refreshes it
// in place as the session continues. Mirrors Studio's src/api/index.ts
// wiring; this app has no per-domain view APIs to add yet — any Kanecta
// component mounted into the content host is expected to bring its own
// data hooks on top of this shared client.
const DEFAULT_API_URL = import.meta.env.VITE_KANECTA_API_URL ?? '/api';

export function createApi(baseUrl: string) {
  return createApiClient({ baseUrl, token: () => keycloak.token });
}

export type KanectaApi = ReturnType<typeof createApi>;

export const api = createApi(DEFAULT_API_URL);
