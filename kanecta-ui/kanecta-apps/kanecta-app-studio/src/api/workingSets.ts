import type { KanectaApiClient, WorkingSet } from '@kanecta/api-client';

export type { WorkingSet, WorkingSetBranch, WorkingSetRemote } from '@kanecta/api-client';
export type {
  BranchFill,
  CreateBranchOptions,
  DiffItemSnapshot,
  DiffDetail,
  MergeStrategy,
  MergeConflict,
  BlastRadiusEntry,
  MergePreview,
  MergeOptions,
  MergeResult,
} from '@kanecta/api-client';
import type { BranchDiff } from '@kanecta/api-client';

/** Counts of a branch's changes vs its upstream (UI state often holds just these). */
export type BranchDiffSummary = Pick<BranchDiff, 'adds' | 'edits' | 'deletes'> &
  Partial<Pick<BranchDiff, 'branch' | 'detail'>>;

/**
 * Normalised shape of `GET /working-sets`.
 *
 * The backend returns `{ workingSets, activeWorkingSet }`; older servers sent
 * the legacy `activeWorkspace` key. We normalise here at the Studio boundary
 * and expose the renamed field.
 */
export interface WorkingSetsList {
  workingSets: WorkingSet[];
  activeWorkingSet: string;
}

export function workingSetsApi(client: KanectaApiClient) {
  const ws = client.workingSets;
  return {
    list: async (): Promise<WorkingSetsList> => {
      const res = await ws.list();
      return {
        // Default to [] — a malformed/empty response must not crash consumers.
        workingSets: res.workingSets ?? [],
        activeWorkingSet: res.activeWorkingSet ?? res.activeWorkspace ?? '',
      };
    },
    activate: ws.activate,
    createBranch: ws.createBranch,
    switchBranch: ws.switchBranch,
    branchDiff: ws.branchDiff,
    /** Conflicts + blast radius a merge into main would produce — applies nothing. */
    getMergePreview: ws.mergePreview,
    mergeBranch: ws.merge,
  };
}
