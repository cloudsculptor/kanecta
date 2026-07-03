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

// The generated client doesn't yet expose the `activate` endpoint, the renamed
// `activeWorkingSet` field, sparse-branch options, or diff/merge, so reach the
// underlying transport for those.
interface RawFetchClient {
  _fetch: (method: string, path: string, body?: unknown) => Promise<unknown>;
}

/** How to fill a new branch: a full copy, or a sparse read-through overlay. */
export type BranchFill = 'full' | 'sparse';

export interface CreateBranchOptions {
  fill?: BranchFill;
  /** For a sparse branch, the branch it reads through to (defaults to current). */
  upstream?: { branch: string };
}

/** Counts of a branch's changes vs its upstream. */
export interface BranchDiffSummary {
  adds: number;
  edits: number;
  deletes: number;
}

/** How merging conflicts are resolved: branch wins, or keep the upstream (main). */
export type MergeStrategy = 'theirs' | 'ours';

/**
 * One item that changed on both sides since the branch forked. `kind`:
 *  - `edit-edit`   both edited it
 *  - `delete-edit` the branch deleted an item main modified
 *  - `add-delete`  the branch kept/edited an item main has since deleted
 */
export interface MergeConflict {
  id: string;
  kind: 'edit-edit' | 'delete-edit' | 'add-delete';
}

/** A deleted item that other items on main still reference (would dangle). */
export interface BlastRadiusEntry {
  id: string;
  referencedBy: Array<{ id: string; via: 'parent' | 'link' | 'relationship' | 'alias' }>;
}

/** `GET .../merge-preview` — what a merge into main would do, applying nothing. */
export interface MergePreview {
  branch: string;
  adds: number;
  edits: number;
  deletes: number;
  conflicts: MergeConflict[];
  blastRadius: BlastRadiusEntry[];
}

/** Options for `POST .../merge`. */
export interface MergeOptions {
  strategy?: MergeStrategy;
  blockOnBlastRadius?: boolean;
}

/** `POST .../merge` success result. */
export interface MergeResult {
  ok: boolean;
  merged: number;
  skipped?: number;
  conflicts?: MergeConflict[];
  blastRadius?: BlastRadiusEntry[];
}

export function workingSetsApi(client: KanectaApiClient) {
  const raw = client as unknown as RawFetchClient;
  const enc = encodeURIComponent;
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
      raw._fetch('POST', `/working-sets/${enc(name)}/activate`) as Promise<{ ok: boolean }>,
    createBranch: (name: string, branchName: string, opts?: CreateBranchOptions) =>
      raw._fetch('POST', `/working-sets/${enc(name)}/branches`, {
        branchName,
        ...(opts?.fill ? { fill: opts.fill } : {}),
        ...(opts?.upstream ? { upstream: opts.upstream } : {}),
      }) as Promise<{ ok: boolean; branch: unknown }>,
    switchBranch: (name: string, branch: string) =>
      client.workingSets.switchBranch(name, branch),
    branchDiff: (name: string, branch: string) =>
      raw._fetch('GET', `/working-sets/${enc(name)}/branches/${enc(branch)}/diff`) as Promise<BranchDiffSummary>,
    /** Conflicts + blast radius a merge into main would produce — applies nothing. */
    getMergePreview: (name: string, branch: string) =>
      raw._fetch('GET', `/working-sets/${enc(name)}/branches/${enc(branch)}/merge-preview`) as Promise<MergePreview>,
    mergeBranch: (name: string, branch: string, opts?: MergeOptions) =>
      raw._fetch('POST', `/working-sets/${enc(name)}/branches/${enc(branch)}/merge`, opts ?? {}) as Promise<MergeResult>,
  };
}
