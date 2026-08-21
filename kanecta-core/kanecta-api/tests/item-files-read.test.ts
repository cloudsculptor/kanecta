/**
 * Read path backing the tree-view's inline image rendering: children rows
 * must carry the meta.files role map, and the file bytes route must serve
 * an MCP-written sidecar.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { Datastore } from '@kanecta/lib';
import app from '../src/app.ts';
import { useConfig, clearConfigEnv } from './helpers.ts';

let tmpRoot: string;
let ds: any;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-files-read-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
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

it('children rows carry meta.files for an MCP-written image item', async () => {
  const tree = await ds.tree(null, 0);
  const rootId = tree[0].item.id;
  const parent = await ds.create({ parentId: rootId, value: 'pics', type: 'node' });
  // Mirror kanecta_write_file's sequence.
  const item = await ds.create({ parentId: parent.id, value: 'photo.jpeg', type: 'file' });
  await ds.putFile(item.id, 'photo.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { mimeType: 'image/jpeg' });
  await ds.update(item.id, { files: { image: 'photo.jpeg' } });
  await ds.writeObjectJson(item.id, { mimeType: 'image/jpeg', size: 4 });

  const res = await request(app).get(`/items/${parent.id}/children`);
  expect(res.status).toBe(200);
  expect(res.body[0].files).toEqual({ image: 'photo.jpeg' });

  const bytes = await request(app).get(`/items/${item.id}/files/photo.jpeg?mime=image/jpeg`);
  expect(bytes.status).toBe(200);
  expect(bytes.headers['content-type']).toContain('image/jpeg');
});
