import type { KanectaApiClient, WorkingSet } from '@kanecta/api-client';

export type { WorkingSet, WorkingSetBranch, WorkingSetRemote } from '@kanecta/api-client';

export function workingSetsApi(client: KanectaApiClient) {
  return {
    list: () => client.workingSets.list(),
    createBranch: (workspaceName: string, branchName: string) =>
      client.workingSets.createBranch(workspaceName, branchName),
    switchBranch: (workspaceName: string, branch: string) =>
      client.workingSets.switchBranch(workspaceName, branch),
  };
}
