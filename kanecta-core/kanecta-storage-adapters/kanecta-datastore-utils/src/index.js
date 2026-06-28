'use strict';

const { FilesystemAdapter } = require('@kanecta/sqlite-fs');

// ─── Filesystem ────────────────────────────────────────────────────────────────

function isDatastore(location) {
  return FilesystemAdapter.isDatastore(location);
}

function createFilesystemAdapter(location, owner) {
  return FilesystemAdapter.init(location, owner);
}

function openFilesystemAdapter(location) {
  return FilesystemAdapter.open(location);
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

  const pool = new Pool({ connectionString: cloudConfig.pg.connectionString });
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

  const pool = new Pool({ connectionString: cloudConfig.pg.connectionString });
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
  openCloudAdapter,
  createCloudAdapter,
  copyDatastore,
  mergeDatastore,
};
