import path from 'path';
import { FilesystemAdapter } from '@kanecta/sqlite-fs';

// ─── Filesystem ────────────────────────────────────────────────────────────────

// Intern filesystem adapters by resolved absolute path. Within one process,
// opening the same datastore twice must yield the SAME adapter instance:
//   - it keeps the in-memory item cache coherent across every consumer (the API
//     request handlers, the CLI, MCP, and — crucially — test fixtures that hold
//     their own handle alongside the code under test); and
//   - it bounds resource use to one instance per datastore (the reason the API
//     hand-rolled its own datastore cache).
// Keyed by path only: branch selection is an in-memory, per-instance concern
// (useBranch) layered on top, matching the current single-index model.
const _adapters = new Map<string, any>(); // resolvedPath → FilesystemAdapter

function _key(location: string): string {
  return path.resolve(location);
}

export function isDatastore(location: string): boolean {
  return FilesystemAdapter.isDatastore(location);
}

export function createFilesystemAdapter(location: string, owner?: any) {
  // init always builds a fresh datastore on disk; replace any interned handle so
  // later opens of this path observe the freshly-initialised instance.
  const adapter = FilesystemAdapter.init(location, owner);
  _adapters.set(_key(location), adapter);
  return adapter;
}

export function openFilesystemAdapter(location: string, options: any = {}) {
  // An options-carrying open (e.g. an embeddings provider) gets its own
  // uncached handle: the interned one stays the plain-config instance other
  // consumers of this path expect.
  if (options.embeddings) return FilesystemAdapter.open(location, options);
  const key = _key(location);
  let adapter = _adapters.get(key);
  if (!adapter) {
    adapter = FilesystemAdapter.open(location);
    _adapters.set(key, adapter);
  }
  return adapter;
}

// Drop an interned adapter (e.g. after a datastore is deleted/rebuilt in tests).
export function forgetFilesystemAdapter(location: string): void {
  _adapters.delete(_key(location));
}

// ─── Cloud ─────────────────────────────────────────────────────────────────────

// `cloudConfig` shape:
//   { pg: { connectionString }, s3: { endpoint, region?, accessKeyId, secretAccessKey, bucket },
//     embeddings?: { provider, apiKey, model, dimensions } }

export async function openCloudAdapter(cloudConfig: any) {
  const { Pool }            = require('pg');
  const { S3Client }        = require('@aws-sdk/client-s3');
  const { PostgresAdapter } = require('@kanecta/database');
  const { S3Adapter }       = require('@kanecta/s3');
  const { CloudAdapter }    = require('@kanecta/cloud');

  const pgOpts: any = { connectionString: cloudConfig.pg.connectionString };
  if (cloudConfig.pg.ssl) pgOpts.ssl = cloudConfig.pg.ssl;
  if (cloudConfig.pg.options) pgOpts.options = cloudConfig.pg.options;
  const pool = new Pool(pgOpts);
  const items = await PostgresAdapter.open(pool, { embeddings: cloudConfig.embeddings ?? null });

  const s3Cfg = cloudConfig.s3;
  const s3client = new S3Client({
    endpoint:       s3Cfg.endpoint,
    region:         s3Cfg.region ?? 'us-east-1',
    credentials:    { accessKeyId: s3Cfg.accessKeyId, secretAccessKey: s3Cfg.secretAccessKey },
    forcePathStyle: true,
  });
  const files = new S3Adapter({ client: s3client, bucket: s3Cfg.bucket });

  return CloudAdapter.open({ items, files });
}

// Open a bare postgres items adapter (no S3) for a branch push target. A push
// moves ITEM changes, and the postgres adapter is the branch gatekeeper
// (createBranch / applyBranchChanges / previewMerge / mergeBranch /
// setBranchBases), so files/S3 are not required. Returns { adapter, pool } so
// the caller can close the pool when the push completes. Assumes the remote has
// already run its migrations (open() does not migrate).
export async function openRemotePgAdapter(pgConfig: any) {
  const { Pool }            = require('pg');
  const { PostgresAdapter } = require('@kanecta/database');
  const pgOpts: any = { connectionString: pgConfig.connectionString };
  if (pgConfig.ssl)     pgOpts.ssl     = pgConfig.ssl;
  if (pgConfig.options) pgOpts.options = pgConfig.options;
  const pool = new Pool(pgOpts);
  const adapter = await PostgresAdapter.open(pool, { embeddings: pgConfig.embeddings ?? null });
  return { adapter, pool };
}

// Apply (or just report) pending Postgres schema migrations against a remote
// database WITHOUT going through open()/init(). open() would fail on a
// not-yet-migrated schema (config read before the migration lands), and init()
// also seeds data — neither is what a migrate step wants. Builds a BARE adapter
// (no open/init), runs the same ledgered runner the app uses, and reports what
// happened. Closes its own pool.
//   opts.apply === false → status only: never mutates, needs no guard.
//   opts.apply === true  → runs _migrate(), which honours KANECTA_ALLOW_SCHEMA_CHANGES.
// Returns { didApply, ran, baseline, status } where `status` is the post-run (or,
// for status-only, current) _migrationStatus() and `baseline` lists any migrations
// that were/would be marked applied WITHOUT running (see _migrationStatus).
export async function migrateRemotePgAdapter(pgConfig: any, { apply = true }: any = {}) {
  const { Pool }            = require('pg');
  const { PostgresAdapter } = require('@kanecta/database');
  const pgOpts: any = { connectionString: pgConfig.connectionString };
  if (pgConfig.ssl)     pgOpts.ssl     = pgConfig.ssl;
  if (pgConfig.options) pgOpts.options = pgConfig.options;
  const pool = new Pool(pgOpts);
  try {
    const adapter = new PostgresAdapter(pool);
    const before  = await adapter._migrationStatus();
    if (!apply) return { didApply: false, ran: [], baseline: before.baseline, status: before };
    const ran = before.pending;
    await adapter._migrate();
    const status = await adapter._migrationStatus();
    return { didApply: true, ran, baseline: before.baseline, status };
  } finally {
    await pool.end();
  }
}

export async function createCloudAdapter(cloudConfig: any, owner?: any) {
  const { Pool }            = require('pg');
  const { S3Client }        = require('@aws-sdk/client-s3');
  const { PostgresAdapter } = require('@kanecta/database');
  const { S3Adapter }       = require('@kanecta/s3');
  const { CloudAdapter }    = require('@kanecta/cloud');

  const pgOpts: any = { connectionString: cloudConfig.pg.connectionString };
  if (cloudConfig.pg.ssl) pgOpts.ssl = cloudConfig.pg.ssl;
  if (cloudConfig.pg.options) pgOpts.options = cloudConfig.pg.options;
  const pool = new Pool(pgOpts);
  const items = await PostgresAdapter.init(pool, owner, { embeddings: cloudConfig.embeddings ?? null });

  const s3Cfg = cloudConfig.s3;
  const s3client = new S3Client({
    endpoint:       s3Cfg.endpoint,
    region:         s3Cfg.region ?? 'us-east-1',
    credentials:    { accessKeyId: s3Cfg.accessKeyId, secretAccessKey: s3Cfg.secretAccessKey },
    forcePathStyle: true,
  });
  const files = new S3Adapter({ client: s3client, bucket: s3Cfg.bucket });

  return CloudAdapter.init({ items, files });
}

// ─── Copy ──────────────────────────────────────────────────────────────────────

// Copy all items from one datastore to another.
// Both `source` and `dest` must be open adapter instances.
// TODO: implement in v1.4.0
export async function copyDatastore(source: any, dest: any): Promise<void> {
  throw new Error('copyDatastore is not yet implemented — coming in v1.4.0');
}

// ─── Merge ─────────────────────────────────────────────────────────────────────

// Merge changes from `remote` into `local` (git-like three-way merge).
// `local` and `remote` must be open adapter instances.
// Returns a MergeResult: { added, updated, deleted, conflicts }
// TODO: implement in v1.4.0
export async function mergeDatastore(local: any, remote: any): Promise<void> {
  throw new Error('mergeDatastore is not yet implemented — coming in v1.4.0');
}
