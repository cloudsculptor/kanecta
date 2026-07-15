// File byte endpoints (POST/GET/DELETE /items/:id/files/:name, GET
// /items/:id/files). Validation + the 501 path run against the default local
// (sqlite-fs) datastore, which has no file store. The real byte round-trip is a
// gated integration test (KANECTA_TEST_FILE_CONFIG = a cloud config dir with an
// S3/MinIO remote) — exercised end-to-end by the community-hub harness too.

import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { Datastore } from '@kanecta/lib';
import app from '../src/app.ts';
import { useConfig, clearConfigEnv } from './helpers.ts';

const VALID_ID = '00000000-0000-0000-0000-000000000000'; // root item

describe('file endpoints — validation + unsupported datastore', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-files-'));
    Datastore.init(tmpRoot, 'test@example.com');
    useConfig(tmpRoot);
    process.env.AUTH_DISABLED = 'true';
    process.env.XDG_CONFIG_HOME = tmpRoot;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    clearConfigEnv();
    delete process.env.AUTH_DISABLED;
    delete process.env.XDG_CONFIG_HOME;
  });

  it('rejects an invalid item id (400)', async () => {
    const res = await request(app).get('/items/not-a-uuid/files/x.txt');
    expect(res.status).toBe(400);
  });

  it('rejects a filename whose decoded form contains a separator (400)', async () => {
    // %2F decodes to '/' inside the :name segment — the guard rejects it so it
    // can't escape the item's key prefix. (A raw '..' segment is normalised away
    // by Express routing before it ever reaches the handler.)
    const res = await request(app).get(`/items/${VALID_ID}/files/a%2Fb`);
    expect(res.status).toBe(400);
  });

  it('rejects an oversized filename (400)', async () => {
    const res = await request(app).post(`/items/${VALID_ID}/files/${'a'.repeat(300)}`).send('x');
    expect(res.status).toBe(400);
  });

  it('POST returns 501 when the datastore cannot store bytes (sqlite-fs putFile)', async () => {
    const put = await request(app).post(`/items/${VALID_ID}/files/x.txt`).set('content-type', 'text/plain').send('hi');
    expect(put.status).toBe(501);
  });

  it('GET a missing file is 404, LIST is an empty array (read stubs are supported)', async () => {
    const get = await request(app).get(`/items/${VALID_ID}/files/nope.txt`);
    expect(get.status).toBe(404);
    const list = await request(app).get(`/items/${VALID_ID}/files`);
    expect(list.status).toBe(200);
    expect(list.body.files).toEqual([]);
  });
});

// Real byte round-trip against a cloud (S3/MinIO) datastore. Gated: set
// KANECTA_TEST_FILE_CONFIG to a config dir whose default working set is a cloud
// remote (e.g. the community-hub config: communityhub_backfill + MinIO), and
// KANECTA_TEST_FILE_ITEM to an item id in it.
const FILE_CFG = process.env.KANECTA_TEST_FILE_CONFIG;
const FILE_ITEM = process.env.KANECTA_TEST_FILE_ITEM || VALID_ID;
const runCloud = FILE_CFG ? describe : describe.skip;

runCloud('file endpoints — byte round-trip (cloud/MinIO)', () => {
  beforeEach(() => {
    process.env.KANECTA_CONFIG = FILE_CFG!;
    process.env.AUTH_DISABLED = 'true';
  });
  afterEach(() => { clearConfigEnv(); delete process.env.AUTH_DISABLED; });

  it('put → list → get → delete round-trips the bytes', async () => {
    const name = `apitest-${Date.now()}.txt`;
    const body = Buffer.from('kanecta-file-endpoint-bytes');

    const put = await request(app).post(`/items/${FILE_ITEM}/files/${name}`)
      .set('content-type', 'text/plain').send(body);
    expect(put.status).toBe(201);
    expect(put.body).toMatchObject({ ok: true, name, size: body.length });

    const list = await request(app).get(`/items/${FILE_ITEM}/files`);
    expect(list.status).toBe(200);
    expect(list.body.files).toContain(name);

    const get = await request(app).get(`/items/${FILE_ITEM}/files/${name}?mime=text/plain`)
      .buffer(true).parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(get.status).toBe(200);
    expect(Buffer.from(get.body).toString()).toBe(body.toString());

    const del = await request(app).delete(`/items/${FILE_ITEM}/files/${name}`);
    expect(del.status).toBe(200);

    const gone = await request(app).get(`/items/${FILE_ITEM}/files/${name}`);
    expect(gone.status).toBe(404);
  });
});
