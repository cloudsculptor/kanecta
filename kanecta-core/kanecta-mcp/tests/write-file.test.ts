/**
 * kanecta_write_file — creates/updates file items: bytes as a sidecar,
 * meta.files role map (image/body/file by mime class), filePayload
 * (mimeType/size/width/height/altText) via writeObjectJson.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { Datastore } from '@kanecta/lib';
import { vi } from 'vitest';
import { singleConfig, clearConfigEnv } from './helpers.ts';

// A 1×1 transparent PNG.
const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let tmpRoot;
let ds;
let dispatch;

beforeEach(async () => {
  vi.resetModules();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-write-file-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  singleConfig(tmpRoot);
  ({ dispatch } = await import('../src/index.ts'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  vi.restoreAllMocks();
});

async function rootId() {
  const tree = await ds.tree(null, 0);
  return tree[0].item.id;
}

test('creates a text file item from inline content (body role)', async () => {
  const parent = await ds.create({ parentId: await rootId(), value: 'docs', type: 'node' });
  const res = await dispatch('kanecta_write_file', {
    parentId: parent.id,
    content: '# Hello\n\nSome notes.',
    value: 'Release notes',
    filename: 'notes.md',
  });
  expect(res.error).toBeUndefined();
  expect(res.item.type).toBe('file');
  expect(res.item.value).toBe('Release notes');
  expect(res.role).toBe('body');
  expect(res.files).toEqual({ body: 'notes.md' });
  expect(res.payload.mimeType).toBe('text/markdown');
  expect(res.payload.size).toBe(Buffer.byteLength('# Hello\n\nSome notes.'));

  // Bytes round-trip; meta.files persisted on the item.
  const bytes = await ds.getFile(res.item.id, 'notes.md');
  expect(bytes.toString('utf8')).toBe('# Hello\n\nSome notes.');
  const item = await ds.get(res.item.id);
  expect(item.files).toEqual({ body: 'notes.md' });
  expect(await ds.readObjectJson(res.item.id)).toMatchObject({
    mimeType: 'text/markdown',
  });
});

test('creates an image file item from a local path with sniffed dimensions', async () => {
  const parent = await ds.create({ parentId: await rootId(), value: 'pics', type: 'node' });
  const src = path.join(tmpRoot, 'photo.png');
  fs.writeFileSync(src, Buffer.from(PNG_1x1_B64, 'base64'));

  const res = await dispatch('kanecta_write_file', {
    parentId: parent.id,
    path: src,
    altText: 'A tiny dot',
  });
  expect(res.error).toBeUndefined();
  expect(res.item.value).toBe('photo.png');
  expect(res.role).toBe('image');
  expect(res.files).toEqual({ image: 'photo.png' });
  expect(res.payload).toMatchObject({
    mimeType: 'image/png',
    width: 1,
    height: 1,
    altText: 'A tiny dot',
  });
  const bytes = await ds.getFile(res.item.id, 'photo.png');
  expect(bytes.equals(Buffer.from(PNG_1x1_B64, 'base64'))).toBe(true);
});

test('accepts base64 content for binary data', async () => {
  const parent = await ds.create({ parentId: await rootId(), value: 'pics', type: 'node' });
  const res = await dispatch('kanecta_write_file', {
    parentId: parent.id,
    content: PNG_1x1_B64,
    encoding: 'base64',
    value: 'dot',
    filename: 'dot.png',
  });
  expect(res.error).toBeUndefined();
  expect(res.role).toBe('image');
  expect(res.payload.width).toBe(1);
  const bytes = await ds.getFile(res.item.id, 'dot.png');
  expect(bytes.equals(Buffer.from(PNG_1x1_B64, 'base64'))).toBe(true);
});

test('update replaces content and retires the old sidecar', async () => {
  const parent = await ds.create({ parentId: await rootId(), value: 'docs', type: 'node' });
  const created = await dispatch('kanecta_write_file', {
    parentId: parent.id,
    content: 'v1',
    value: 'Doc',
    filename: 'doc.txt',
  });

  const updated = await dispatch('kanecta_write_file', {
    id: created.item.id,
    content: PNG_1x1_B64,
    encoding: 'base64',
    filename: 'doc.png',
    value: 'Doc v2',
  });
  expect(updated.error).toBeUndefined();
  expect(updated.item.value).toBe('Doc v2');
  // The role moved body → image and the old sidecar is gone.
  expect(updated.files).toEqual({ image: 'doc.png' });
  expect(await ds.getFile(created.item.id, 'doc.txt')).toBeNull();
  expect((await ds.getFile(created.item.id, 'doc.png')).length).toBeGreaterThan(0);
  // Payload tracks the new bytes — no stale text-era fields.
  expect(updated.payload.mimeType).toBe('image/png');
  expect(updated.payload.width).toBe(1);
});

test('update with same filename just rewrites bytes', async () => {
  const parent = await ds.create({ parentId: await rootId(), value: 'docs', type: 'node' });
  const created = await dispatch('kanecta_write_file', {
    parentId: parent.id,
    content: 'v1',
    value: 'Doc',
    filename: 'doc.txt',
  });
  const updated = await dispatch('kanecta_write_file', {
    id: created.item.id,
    content: 'v2 content',
    filename: 'doc.txt',
  });
  expect(updated.error).toBeUndefined();
  expect(updated.files).toEqual({ body: 'doc.txt' });
  expect((await ds.getFile(created.item.id, 'doc.txt')).toString('utf8')).toBe('v2 content');
  expect(updated.payload.size).toBe(Buffer.byteLength('v2 content'));
});

test('rejects bad inputs with errors, not throws', async () => {
  const parent = await ds.create({ parentId: await rootId(), value: 'docs', type: 'node' });

  const noBytes = await dispatch('kanecta_write_file', { parentId: parent.id, value: 'x' });
  expect(noBytes.error).toMatch(/path or content/);

  const noTarget = await dispatch('kanecta_write_file', { content: 'x', value: 'x' });
  expect(noTarget.error).toMatch(/id .* or parentId/);

  const badParent = await dispatch('kanecta_write_file', {
    parentId: '99999999-9999-4999-8999-999999999999', content: 'x', value: 'x',
  });
  expect(badParent.error).toMatch(/Parent not found/);

  const badPath = await dispatch('kanecta_write_file', {
    parentId: parent.id, path: path.join(tmpRoot, 'nope.bin'),
  });
  expect(badPath.error).toMatch(/Cannot read/);

  const badName = await dispatch('kanecta_write_file', {
    parentId: parent.id, content: 'x', value: 'x', filename: 'item.json',
  });
  expect(badName.error).toMatch(/Invalid sidecar filename/);

  const notAFile = await dispatch('kanecta_write_file', {
    id: parent.id, content: 'x',
  });
  expect(notAFile.error).toMatch(/not a file item/);

  // Missing value when creating from inline content.
  const noValue = await dispatch('kanecta_write_file', { parentId: parent.id, content: 'x' });
  expect(noValue.error).toMatch(/value is required/);
});

test('mime detection falls back to octet-stream (file role)', async () => {
  const parent = await ds.create({ parentId: await rootId(), value: 'bin', type: 'node' });
  const res = await dispatch('kanecta_write_file', {
    parentId: parent.id,
    content: 'AAEC',
    encoding: 'base64',
    value: 'blob',
    filename: 'data.xyz',
  });
  expect(res.error).toBeUndefined();
  expect(res.payload.mimeType).toBe('application/octet-stream');
  expect(res.role).toBe('file');
  expect(res.files).toEqual({ file: 'data.xyz' });
});
