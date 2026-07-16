'use strict';

// File store (sidecars) — spec «Files and Sidecars»: bytes live as sidecar files
// alongside item.json in the item's folder, with the same byte-store surface as
// the S3 adapter (putFile/getFile/deleteFile/listFiles).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteFsAdapter } from '../src/adapter';

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-files-'));
  return SqliteFsAdapter.init(root, 'test@example.com');
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

describe('file store (sidecars)', () => {
  let a: any;
  let item: any;
  beforeEach(() => {
    a = tmpAdapter();
    item = a.create({ value: 'holder', type: 'text' });
  });
  afterEach(() => cleanup(a));

  test('putFile/getFile round-trips bytes and the sidecar sits next to item.json', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    a.putFile(item.id, 'image.png', bytes, { mimeType: 'image/png' });
    expect(a.getFile(item.id, 'image.png')).toEqual(bytes);
    // physically alongside item.json in the item's folder
    const dir = a._itemDir(item.id);
    expect(fs.existsSync(path.join(dir, 'item.json'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'image.png'))).toEqual(bytes);
    // no .tmp staging file left behind
    expect(fs.readdirSync(dir).filter((n: string) => n.endsWith('.tmp'))).toEqual([]);
  });

  test('string and TypedArray bodies are accepted; streams are rejected', () => {
    a.putFile(item.id, 'body.md', '# hello');
    expect(a.getFile(item.id, 'body.md').toString()).toBe('# hello');
    a.putFile(item.id, 'embedding.bin', new Uint8Array([1, 2, 3]));
    expect([...a.getFile(item.id, 'embedding.bin')]).toEqual([1, 2, 3]);
    expect(() => a.putFile(item.id, 'x.bin', { pipe() {} })).toThrow(/Buffer/);
    expect(() => a.putFile(item.id, 'x.bin', null)).toThrow(/Buffer/);
  });

  test('getFile returns null for an absent sidecar or unknown item', () => {
    expect(a.getFile(item.id, 'nope.bin')).toBeNull();
    expect(a.getFile('99999999-9999-4999-8999-999999999999', 'x')).toBeNull();
  });

  test('putFile requires an existing item', () => {
    expect(() => a.putFile('99999999-9999-4999-8999-999999999999', 'x.bin', Buffer.from('x')))
      .toThrow(/not found/);
  });

  test('sidecar filename is one path segment: traversal, item.json and .tmp are rejected', () => {
    for (const bad of ['../evil', 'a/b', 'a\\b', '.', '..', 'item.json', 'x.tmp', '', 42]) {
      expect(() => a.putFile(item.id, bad, Buffer.from('x'))).toThrow(/invalid sidecar/);
    }
    // reads/deletes with invalid names are safe no-ops
    expect(a.getFile(item.id, '../../etc/passwd')).toBeNull();
    expect(() => a.deleteFile(item.id, '../evil')).not.toThrow();
  });

  test('listFiles returns sorted sidecar names, never item.json; deleteFile is idempotent', () => {
    a.putFile(item.id, 'b.bin', Buffer.from('b'));
    a.putFile(item.id, 'a.bin', Buffer.from('a'));
    expect(a.listFiles(item.id)).toEqual(['a.bin', 'b.bin']);
    a.deleteFile(item.id, 'a.bin');
    a.deleteFile(item.id, 'a.bin'); // idempotent
    expect(a.listFiles(item.id)).toEqual(['b.bin']);
    expect(a.getFile(item.id, 'a.bin')).toBeNull();
    expect(a.listFiles('99999999-9999-4999-8999-999999999999')).toEqual([]);
  });

  test('overwrite replaces the bytes atomically', () => {
    a.putFile(item.id, 'f.txt', 'v1');
    a.putFile(item.id, 'f.txt', 'v2 longer content');
    expect(a.getFile(item.id, 'f.txt').toString()).toBe('v2 longer content');
    expect(a.listFiles(item.id)).toEqual(['f.txt']);
  });

  test('hard delete removes the item folder including its sidecars', () => {
    a.putFile(item.id, 'image.png', Buffer.from('png'));
    const dir = a._itemDir(item.id);
    a.delete(item.id);
    expect(fs.existsSync(dir)).toBe(false);
    expect(a.getFile(item.id, 'image.png')).toBeNull();
  });

  test('full branches are isolated: a sidecar written on one branch is not visible on another', () => {
    a.putFile(item.id, 'main-only.bin', Buffer.from('m'));
    a.createBranch('feature/files');
    a.switchBranch('feature/files');
    // full branch copies the tree, so the sidecar came across with the folder…
    // …but new writes stay local to the branch
    a.putFile(item.id, 'feature-only.bin', Buffer.from('f'));
    a.switchBranch('main');
    expect(a.getFile(item.id, 'feature-only.bin')).toBeNull();
    expect(a.getFile(item.id, 'main-only.bin')).not.toBeNull();
  });
});
