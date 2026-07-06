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

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
  type GetObjectCommandOutput,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';

interface S3AdapterOptions {
  client: S3Client;
  bucket: string;
}

// The shape in config.json's remote definition.
interface S3AdapterConfig {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

interface PutFileOptions {
  mimeType?: string;
}

class S3Adapter {
  private readonly _client: S3Client;
  private readonly _bucket: string;

  constructor({ client, bucket }: S3AdapterOptions) {
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
  static fromConfig(cfg: S3AdapterConfig = {}): S3Adapter {
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

  async putFile(
    itemId: string,
    filename: string,
    body: PutObjectCommandInput['Body'],
    opts: PutFileOptions = {},
  ): Promise<void> {
    await this._client.send(new PutObjectCommand({
      Bucket: this._bucket,
      Key: this._objectKey(itemId, filename),
      Body: body,
      ContentType: opts.mimeType,
    }));
  }

  async getFile(itemId: string, filename: string): Promise<Buffer | null> {
    let res: GetObjectCommandOutput;
    try {
      res = await this._client.send(new GetObjectCommand({
        Bucket: this._bucket,
        Key: this._objectKey(itemId, filename),
      }));
    } catch (err) {
      // A missing object surfaces differently across S3 gateways: NoSuchKey (AWS
      // GetObject), NotFound (HEAD-style), or a bare 404. Treat all as absent.
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
    // aws-sdk v3: the response Body is a stream with helper transforms; use
    // transformToByteArray() (there is no .toArray()).
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async deleteFile(itemId: string, filename: string): Promise<void> {
    await this._client.send(new DeleteObjectCommand({
      Bucket: this._bucket,
      Key: this._objectKey(itemId, filename),
    }));
  }

  async listFiles(itemId: string): Promise<string[]> {
    const prefix = this._objectKey(itemId, '');
    const filenames: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res: ListObjectsV2CommandOutput = await this._client.send(new ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const obj of res.Contents ?? []) {
        filenames.push(obj.Key!.slice(prefix.length));
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return filenames;
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _objectKey(itemId: string, filename: string): string {
    const hex = itemId.replace(/-/g, '');
    return `files/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${itemId}/${filename}`;
  }
}

export { S3Adapter };
