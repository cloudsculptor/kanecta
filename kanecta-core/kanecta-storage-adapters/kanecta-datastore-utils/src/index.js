'use strict';

const path = require('path');
const { FilesystemAdapter } = require('@kanecta/sqlite-fs');

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
const _adapters = new Map(); // resolvedPath → FilesystemAdapter

function _key(location) {
  return path.resolve(location);
}

function isDatastore(location) {
  return FilesystemAdapter.isDatastore(location);
}

function createFilesystemAdapter(location, owner) {
  // init always builds a fresh datastore on disk; replace any interned handle so
  // later opens of this path observe the freshly-initialised instance.
  const adapter = FilesystemAdapter.init(location, owner);
  _adapters.set(_key(location), adapter);
  return adapter;
}

function openFilesystemAdapter(location) {
  const key = _key(location);
  let adapter = _adapters.get(key);
  if (!adapter) {
    adapter = FilesystemAdapter.open(location);
    _adapters.set(key, adapter);
  }
  return adapter;
}

// Drop an interned adapter (e.g. after a datastore is deleted/rebuilt in tests).
function forgetFilesystemAdapter(location) {
  _adapters.delete(_key(location));
}

// ─── Cloud ─────────────────────────────────────────────────────────────────────

// `cloudConfig` shape:
//   { pg: { connectionString }, s3: { endpoint, region?, accessKeyId, secretAccessKey, bucket },
//     embeddings?: { provider, apiKey, model, dimensions } }

async function openCloudAdapter(cloudConfig) {
  const { Pool }            = require('pg');
  const { S3Client }        = require('@aws-sdk/client-s3');
  const { PostgresAdapter } = require('@kanecta/database');
  const { S3Adapter }       = require('@kanecta/s3');
  const { CloudAdapter }    = require('@kanecta/cloud');

  const pgOpts = { connectionString: cloudConfig.pg.connectionString };
  if (cloudConfig.pg.ssl) pgOpts.ssl = cloudConfig.pg.ssl;
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

async function createCloudAdapter(cloudConfig, owner) {
  const { Pool }            = require('pg');
  const { S3Client }        = require('@aws-sdk/client-s3');
  const { PostgresAdapter } = require('@kanecta/database');
  const { S3Adapter }       = require('@kanecta/s3');
  const { CloudAdapter }    = require('@kanecta/cloud');

  const pgOpts = { connectionString: cloudConfig.pg.connectionString };
  if (cloudConfig.pg.ssl) pgOpts.ssl = cloudConfig.pg.ssl;
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
async function copyDatastore(source, dest) {
  throw new Error('copyDatastore is not yet implemented — coming in v1.4.0');
}

// ─── Merge ─────────────────────────────────────────────────────────────────────

// Merge changes from `remote` into `local` (git-like three-way merge).
// `local` and `remote` must be open adapter instances.
// Returns a MergeResult: { added, updated, deleted, conflicts }
// TODO: implement in v1.4.0
async function mergeDatastore(local, remote) {
  throw new Error('mergeDatastore is not yet implemented — coming in v1.4.0');
}

module.exports = {
  isDatastore,
  createFilesystemAdapter,
  openFilesystemAdapter,
  forgetFilesystemAdapter,
  openCloudAdapter,
  createCloudAdapter,
  copyDatastore,
  mergeDatastore,
};
