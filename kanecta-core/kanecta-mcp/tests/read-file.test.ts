/**
 * kanecta_read_file — downloads a file item's stored bytes (the sidecar
 * content, not the item JSON): inline as utf8/base64 by mime class, or
 * written to an outputPath on disk.
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-read-file-test-'));
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

async function writeFileItem(overrides = {}) {
  const parent = await ds.create({ parentId: await rootId(), value: 'files', type: 'node' });
  return dispatch('kanecta_write_file', { parentId: parent.id, value: 'a file', ...overrides });
}

test('reads a text file inline as utf8 by default', async () => {
  const written = await writeFileItem({
    content: '# Hello\n\nSome notes.',
    value: 'Release notes',
    filename: 'notes.md',
  });

  const res = await dispatch('kanecta_read_file', { id: written.item.id });
  expect(res.error).toBeUndefined();
  expect(res).toMatchObject({
    filename: 'notes.md',
    mimeType: 'text/markdown',
    encoding: 'utf8',
    size: Buffer.byteLength('# Hello\n\nSome notes.'),
  });
  expect(res.content).toBe('# Hello\n\nSome notes.');
});

test('reads a binary (image) file inline as base64 by default', async () => {
  const written = await writeFileItem({
    content: PNG_1x1_B64,
    encoding: 'base64',
    value: 'photo.png',
  });
  expect(written.files).toEqual({ image: 'photo.png' });

  const res = await dispatch('kanecta_read_file', { id: written.item.id });
  expect(res.error).toBeUndefined();
  expect(res.filename).toBe('photo.png');
  expect(res.mimeType).toBe('image/png');
  expect(res.encoding).toBe('base64');
  expect(res.content).toBe(PNG_1x1_B64);
});

test('an explicit encoding overrides the mime-class default', async () => {
  const written = await writeFileItem({ content: 'plain text', filename: 'notes.txt' });
  const res = await dispatch('kanecta_read_file', { id: written.item.id, encoding: 'base64' });
  expect(res.encoding).toBe('base64');
  expect(Buffer.from(res.content, 'base64').toString('utf8')).toBe('plain text');
});

test('writes the bytes to outputPath, creating parent directories', async () => {
  const written = await writeFileItem({
    content: PNG_1x1_B64,
    encoding: 'base64',
    value: 'photo.png',
  });

  const out = path.join(tmpRoot, 'out', 'nested', 'saved.png');
  const res = await dispatch('kanecta_read_file', { id: written.item.id, outputPath: out });
  expect(res.error).toBeUndefined();
  expect(res).toMatchObject({ filename: 'photo.png', mimeType: 'image/png', path: out });
  expect(res.content).toBeUndefined();
  expect(fs.readFileSync(out).toString('base64')).toBe(PNG_1x1_B64);
});

test('an explicit filename reads that sidecar with extension-detected mime', async () => {
  const written = await writeFileItem({ content: 'body', filename: 'notes.md' });
  // A second sidecar outside the meta.files role map.
  await ds.putFile(written.item.id, 'extra.json', Buffer.from('{"a":1}'), {
    mimeType: 'application/json',
  });

  const res = await dispatch('kanecta_read_file', {
    id: written.item.id,
    filename: 'extra.json',
  });
  expect(res.error).toBeUndefined();
  expect(res.mimeType).toBe('application/json');
  expect(res.encoding).toBe('utf8');
  expect(res.content).toBe('{"a":1}');
});

test('errors: unknown item, no stored files, missing sidecar', async () => {
  expect((await dispatch('kanecta_read_file', { id: 'no-such-id' })).error).toMatch(/Not found/);

  const bare = await ds.create({ parentId: await rootId(), value: 'empty', type: 'file' });
  expect((await dispatch('kanecta_read_file', { id: bare.id })).error).toMatch(
    /no stored files/,
  );

  const written = await writeFileItem({ content: 'x', filename: 'notes.txt' });
  const res = await dispatch('kanecta_read_file', { id: written.item.id, filename: 'gone.bin' });
  expect(res.error).toMatch(/No stored file "gone.bin"/);
  expect(res.error).toContain('notes.txt');
});
