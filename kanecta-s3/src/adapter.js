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

const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

class S3Adapter {
  constructor({ client, bucket }) {
    this._client = client;
    this._bucket = bucket;
  }

  // ─── File operations ───────────────────────────────────────────────────────

  async putFile(itemId, filename, body, opts = {}) {
    await this._client.send(new PutObjectCommand({
      Bucket: this._bucket,
      Key: this._objectKey(itemId, filename),
      Body: body,
      ContentType: opts.mimeType,
    }));
  }

  async getFile(itemId, filename) {
    let res;
    try {
      res = await this._client.send(new GetObjectCommand({
        Bucket: this._bucket,
        Key: this._objectKey(itemId, filename),
      }));
    } catch (err) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
    return Buffer.concat(await res.Body.toArray());
  }

  async deleteFile(itemId, filename) {
    await this._client.send(new DeleteObjectCommand({
      Bucket: this._bucket,
      Key: this._objectKey(itemId, filename),
    }));
  }

  async listFiles(itemId) {
    const prefix = this._objectKey(itemId, '');
    const filenames = [];
    let continuationToken;
    do {
      const res = await this._client.send(new ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const obj of res.Contents ?? []) {
        filenames.push(obj.Key.slice(prefix.length));
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return filenames;
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _objectKey(itemId, filename) {
    const hex = itemId.replace(/-/g, '');
    return `files/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${itemId}/${filename}`;
  }
}

module.exports = { S3Adapter };
