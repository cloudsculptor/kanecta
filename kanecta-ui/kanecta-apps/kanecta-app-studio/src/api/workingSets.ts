import type { KanectaApiClient, WorkingSet } from '@kanecta/api-client';

export type { WorkingSet, WorkingSetBranch, WorkingSetRemote } from '@kanecta/api-client';

/**
 * Normalised shape of `GET /working-sets`.
 *
 * The backend returns `{ workingSets, activeWorkingSet }`. The generated
 * api-client type still describes the legacy `activeWorkspace` key, so we
 * normalise here at the Studio boundary and expose the renamed field.
 */
export interface WorkingSetsList {
  workingSets: WorkingSet[];
  activeWorkingSet: string;
}

// The generated client doesn't yet expose the `activate` endpoint or the
// renamed `activeWorkingSet` field, so reach the underlying transport for those.
interface RawFetchClient {
  _fetch: (method: string, path: string, body?: unknown) => Promise<unknown>;
}

export function workingSetsApi(client: KanectaApiClient) {
  const raw = client as unknown as RawFetchClient;
  return {
    list: async (): Promise<WorkingSetsList> => {
      const res = (await client.workingSets.list()) as {
        workingSets: WorkingSet[];
        activeWorkingSet?: string;
        activeWorkspace?: string;
      };
      return {
        workingSets: res.workingSets,
        activeWorkingSet: res.activeWorkingSet ?? res.activeWorkspace ?? '',
      };
    },
    activate: (name: string) =>
      raw._fetch('POST', `/working-sets/${encodeURIComponent(name)}/activate`) as Promise<{
        ok: boolean;
      }>,
    createBranch: (name: string, branchName: string) =>
      client.workingSets.createBranch(name, branchName),
    switchBranch: (name: string, branch: string) =>
      client.workingSets.switchBranch(name, branch),
  };
}
