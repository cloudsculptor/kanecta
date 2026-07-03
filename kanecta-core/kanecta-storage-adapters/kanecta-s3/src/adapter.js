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
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

class S3Adapter {
  constructor({ client, bucket }) {
    if (!client) throw new Error('S3Adapter: `client` (an S3Client) is required');
    if (!bucket) throw new Error('S3Adapter: `bucket` is required');
    this._client = client;
    this._bucket = bucket;
  }

  // Build an adapter from plain config (the shape in config.json's remote
  // definition) rather than a pre-constructed S3Client. `forcePathStyle` defaults
  // to true because MinIO / R2 / most self-hosted gateways require path-style URLs;
  // set it false for AWS S3 virtual-hosted-style. `endpoint` is omitted for real
  // AWS (the SDK derives it from `region`).
  //   { endpoint?, region?, bucket, accessKeyId?, secretAccessKey?, forcePathStyle? }
  static fromConfig(cfg = {}) {
    const {
      endpoint,
      region = 'us-east-1',
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle = true,
    } = cfg;
    if (!bucket) throw new Error('S3Adapter.fromConfig: `bucket` is required');
    const client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
    return new S3Adapter({ client, bucket });
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
      // A missing object surfaces differently across S3 gateways: NoSuchKey (AWS
      // GetObject), NotFound (HEAD-style), or a bare 404. Treat all as absent.
      if (err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
    // aws-sdk v3: the response Body is a stream with helper transforms; use
    // transformToByteArray() (there is no .toArray()).
    return Buffer.from(await res.Body.transformToByteArray());
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
