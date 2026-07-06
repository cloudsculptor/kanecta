'use strict';

// SyncEngine — drives the local→remote sync flow for a single branch.
//
// Lifecycle:
//   1. diff(local, remote, branchName) — compare local branch overlay vs remote main
//   2. push(local, remote, branchName) — write local branch_changes to remote branch
//   3. preFlightScan(remote, branchName) — blast-radius check before merge
//   4. merge(remote, branchName) — atomic merge into remote main tables
//
// This engine does NOT write to the remote directly during sync — it only
// applies changes through the adapter's own methods (createBranch, applyBranchChanges,
// mergeBranch) so the adapter remains the single write gatekeeper.
//
// "local" is a sqlite-fs adapter (or any adapter implementing branchDiff).
// "remote" is a Postgres adapter (or any adapter implementing the Postgres
//   branching methods: createBranch, applyBranchChanges, preFlightScan, mergeBranch).

class SyncEngine {
  // diff() — return the local branch diff without touching the remote.
  // Returns { adds[], edits[], deletes[], branchName } where each element
  // is an item object from the local branch overlay.
  static async diff(localAdapter: any, branchName: any) {
    if (typeof localAdapter.branchDiff !== 'function') {
      throw new Error('localAdapter does not implement branchDiff()');
    }
    const delta = await localAdapter.branchDiff(branchName);
    return { ...delta, branchName };
  }

  // push() — create a matching branch on the remote and upload all local
  // branch_changes as branch_changes rows on the remote.
  //
  // Returns { branchId, pushed: number } where `pushed` is the number of
  // change records written to the remote.
  //
  // Idempotent: if the remote branch already exists, the existing branch is
  // used (changes are upserted).
  static async push(localAdapter: any, remoteAdapter: any, branchName: any) {
    if (typeof localAdapter.branchDiff !== 'function') {
      throw new Error('localAdapter does not implement branchDiff()');
    }
    if (typeof remoteAdapter.applyBranchChanges !== 'function') {
      throw new Error('remoteAdapter does not implement applyBranchChanges()');
    }

    // Get or create the remote branch
    let remoteBranch = await remoteAdapter.getBranch(branchName);
    if (!remoteBranch) {
      remoteBranch = await remoteAdapter.createBranch(branchName);
    }
    const branchId = remoteBranch.id;

    // Read local branch overlay: full item.json docs for each changed item
    const { adds, edits, deletes } = await localAdapter.branchDiff(branchName);

    const changes: any[] = [];

    // branchDiff returns { id, after: <flatItem>, doc: <fiveSectionDoc> } for adds/edits
    // and { id, before: <flatItem> } for deletes.
    for (const entry of adds) {
      changes.push(..._entryToChanges(entry, 'create'));
    }
    for (const entry of edits) {
      changes.push(..._entryToChanges(entry, 'update'));
    }
    for (const entry of deletes) {
      const itemId = typeof entry === 'string' ? entry : entry.id;
      changes.push({ itemId, changeType: 'delete', section: 'item', data: null });
    }

    if (changes.length) {
      await remoteAdapter.applyBranchChanges(branchId, changes);
    }

    return { branchId, pushed: changes.length };
  }

  // preFlightScan() — run blast-radius analysis on the remote before merge.
  // Returns the full scan result from the remote adapter.
  static async preFlightScan(remoteAdapter: any, branchName: any) {
    if (typeof remoteAdapter.preFlightScan !== 'function') {
      throw new Error('remoteAdapter does not implement preFlightScan()');
    }
    const remoteBranch = await remoteAdapter.getBranch(branchName);
    if (!remoteBranch) {
      throw new Error(`Branch "${branchName}" not found on remote`);
    }
    return remoteAdapter.preFlightScan(remoteBranch.id);
  }

  // merge() — atomically merge the remote branch into remote main tables.
  // Throws if the branch is blocked (blockingRefs.length > 0) unless
  // `force: true` is passed.
  //
  // Returns { merged: number, branchName } from the remote adapter.
  static async merge(remoteAdapter: any, branchName: any, { force = false }: any = {}) {
    if (typeof remoteAdapter.mergeBranch !== 'function') {
      throw new Error('remoteAdapter does not implement mergeBranch()');
    }
    const remoteBranch = await remoteAdapter.getBranch(branchName);
    if (!remoteBranch) {
      throw new Error(`Branch "${branchName}" not found on remote`);
    }

    if (!force) {
      const scan = await remoteAdapter.preFlightScan(remoteBranch.id);
      if (scan.blocked) {
        const ids = scan.blockingRefs.map((r: any) => r.referenceItemId).join(', ');
        throw new Error(`Merge blocked: ${scan.blockingRefs.length} reference item(s) with blockDeletion=true target deleted items: ${ids}`);
      }
    }

    return remoteAdapter.mergeBranch(remoteBranch.id);
  }

  // fullSync() — convenience: diff → push → preFlightScan → merge in one call.
  // If the scan is blocked, throws without merging (unless force: true).
  // Returns { diff, push: pushResult, scan, merge: mergeResult }.
  static async fullSync(localAdapter: any, remoteAdapter: any, branchName: any, { force = false }: any = {}) {
    const diffResult = await SyncEngine.diff(localAdapter, branchName);
    const pushResult = await SyncEngine.push(localAdapter, remoteAdapter, branchName);
    const scan       = await SyncEngine.preFlightScan(remoteAdapter, branchName);

    if (scan.blocked && !force) {
      throw new Error(`Sync blocked at pre-flight scan: ${scan.blockingRefs.length} blocking reference(s)`);
    }

    const mergeResult = await SyncEngine.merge(remoteAdapter, branchName, { force });
    return { diff: diffResult, push: pushResult, scan, merge: mergeResult };
  }
}

// Convert a branchDiff entry ({ id, after, doc }) into per-section change records.
// `doc` is the raw five-section item.json: { item, meta, search, payload, time }.
// Falls back to building from `after` (flat item) when `doc` is absent.
// Also accepts a plain flat item (no wrapping) for compatibility with unit-test mocks.
function _entryToChanges(entry: any, changeType: any) {
  if (!entry) return [];
  // If the entry IS a flat item (has value/type at top level, no doc/after wrapper),
  // normalise it into the entry shape.
  if (!entry.doc && !entry.after && entry.value !== undefined) {
    entry = { id: entry.id, after: entry, doc: null };
  }
  const itemId = entry.id;
  if (!itemId) return [];

  const changes: any[] = [];

  if (entry.doc) {
    // Use the five-section doc directly — each present section becomes one change record.
    const { item: itemSec, meta, search, payload, time } = entry.doc;
    if (itemSec) changes.push({ itemId, changeType, section: 'item',    data: itemSec });
    if (meta)    changes.push({ itemId, changeType, section: 'meta',    data: meta });
    if (search)  changes.push({ itemId, changeType, section: 'search',  data: search });
    if (payload) changes.push({ itemId, changeType, section: 'payload', data: payload });
    if (time && Object.keys(time).length)
                 changes.push({ itemId, changeType, section: 'time',    data: time });
  } else if (entry.after) {
    // Fallback: build from flattened item (used by mock adapters in unit tests).
    const item = entry.after;
    changes.push({
      itemId, changeType, section: 'item',
      data: {
        value:     item.value,
        type:      item.type,
        typeId:    item.typeId ?? null,
        parentId:  item.parentId,
        aspect:    item.aspect ?? null,
        sortOrder: item.sortOrder ?? 0,
      },
    });
    const meta: any = {};
    for (const k of ['specVersion','owner','license','visibility','confidence','status','tags',
                      'createdAt','modifiedAt','createdBy','modifiedBy',
                      'expiresAt','deletedAt','connectorId','materialized',
                      'sourceSystem','sourceExternalId']) {
      if (item[k] !== undefined) meta[k] = item[k];
    }
    if (Object.keys(meta).length) changes.push({ itemId, changeType, section: 'meta', data: meta });
    if (item.search)             changes.push({ itemId, changeType, section: 'search',  data: item.search });
    if (item.payload !== undefined) changes.push({ itemId, changeType, section: 'payload', data: item.payload });
    if (item.time)               changes.push({ itemId, changeType, section: 'time',    data: item.time });
  }

  return changes;
}

export { SyncEngine };
