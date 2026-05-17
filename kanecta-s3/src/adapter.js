'use strict';

// S3Adapter implements the Kanecta files adapter interface against any
// S3-compatible object store (AWS S3, MinIO, Cloudflare R2, etc.).
//
// Usage:
//   const adapter = new S3Adapter({ client, bucket });
//
// `client` is an @aws-sdk/client-s3 S3Client instance.
// `bucket`  is the bucket name. The caller owns the bucket lifecycle.
//
// Object key layout mirrors the filesystem sharding scheme:
//   files/<hex[0:2]>/<hex[2:4]>/<item-id>/<filename>

class S3Adapter {
  constructor({ client, bucket }) {
    this._client = client;
    this._bucket = bucket;
  }

  // ─── File operations ───────────────────────────────────────────────────────

  async putFile(_itemId, _filename, _body, _opts) {
    throw new Error('S3Adapter.putFile() not yet implemented');
  }

  async getFile(_itemId, _filename) {
    throw new Error('S3Adapter.getFile() not yet implemented');
  }

  async deleteFile(_itemId, _filename) {
    throw new Error('S3Adapter.deleteFile() not yet implemented');
  }

  async listFiles(_itemId) {
    throw new Error('S3Adapter.listFiles() not yet implemented');
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _objectKey(itemId, filename) {
    const hex = itemId.replace(/-/g, '');
    return `files/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${itemId}/${filename}`;
  }
}

module.exports = { S3Adapter };
