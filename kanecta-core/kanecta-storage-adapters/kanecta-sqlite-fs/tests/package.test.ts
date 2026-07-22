'use strict';

// Packages — the exchange format (PROVISIONAL v0.1). A sparse branch's delta
// zipped for transport; import materialises it as a fresh sparse branch on the
// receiver, and the EXISTING merge machinery (preview → conflicts → merge) is
// the review surface. Design: plans/package-format-design.md.

import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { SqliteFsAdapter } from '../src/adapter';

function tmpRoot(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

// Sender datastore with base content, plus a RECEIVER cloned from the same
// base (same item ids — two community groups that started from a shared
// dataset), created by copying the datastore root before any branch work.
function senderAndReceiver() {
  const aRoot = tmpRoot('kanecta-package-a-');
  const a = SqliteFsAdapter.init(aRoot, 'sender@example.com');
  const shared = a.create({ value: 'shared doc', type: 'text' });
  const doomed = a.create({ value: 'doomed', type: 'text' });

  const bRoot = tmpRoot('kanecta-package-b-');
  fs.rmSync(bRoot, { recursive: true, force: true });
  fs.cpSync(aRoot, bRoot, { recursive: true });
  const b = SqliteFsAdapter.open(bRoot);
  b.rebuildIndexes();

  return { a, b, shared, doomed };
}

describe('package export', () => {
  test('exportPackage zips the branch delta with manifest, bases, README', () => {
    const { a, b, shared, doomed } = senderAndReceiver();
    a.createBranch('outbox'); // sparse by default
    a.useBranch('outbox');
    a.update(shared.id, { value: 'shared doc v2' });
    const added = a.create({ value: 'brand new', type: 'text' });
    a.putFile(added.id, 'photo.jpg', Buffer.from('jpeg-bytes'));
    a.delete(doomed.id);

    const out = path.join(os.tmpdir(), `test-${Date.now()}.kanecta-package`);
    const { manifest } = a.exportPackage('outbox', out);

    expect(manifest.format).toBe('kanecta-package');
    expect(manifest.formatVersion).toBe('0.1');
    expect(manifest.source.owner).toBe('sender@example.com');
    expect(manifest.source.branch).toBe('outbox');
    expect(manifest.counts).toEqual({ adds: 1, edits: 1, deletes: 1, filePuts: 1, fileDeletes: 0 });

    const zip = new AdmZip(out);
    const names = zip.getEntries().map(e => e.entryName);
    expect(names).toContain('manifest.json');
    expect(names).toContain('bases.json');
    expect(names).toContain('README.md');
    expect(names.some(n => n.endsWith(`${shared.id}/item.json`))).toBe(true);
    expect(names.some(n => n.endsWith('photo.jpg'))).toBe(true);

    fs.rmSync(out); cleanup(a); cleanup(b);
  });

  test('exportPackage refuses main and full branches', () => {
    const { a, b } = senderAndReceiver();
    a.createBranch('mirror', { fill: 'full' });
    expect(() => a.exportPackage('main', '/tmp/x.zip')).toThrow(/non-main/);
    expect(() => a.exportPackage('mirror', '/tmp/x.zip')).toThrow(/sparse/);
    cleanup(a); cleanup(b);
  });
});

describe('package import → review → merge (the inbox flow)', () => {
  test('round-trip: receiver stages the package as a branch, preview is clean, merge applies everything', () => {
    const { a, b, shared, doomed } = senderAndReceiver();
    a.createBranch('outbox');
    a.useBranch('outbox');
    a.update(shared.id, { value: 'shared doc v2' });
    const added = a.create({ value: 'brand new', type: 'text' });
    a.putFile(added.id, 'photo.jpg', Buffer.from('jpeg-bytes'));
    a.delete(doomed.id);
    const out = path.join(os.tmpdir(), `test-rt-${Date.now()}.kanecta-package`);
    a.exportPackage('outbox', out);

    const { branch, manifest } = b.importPackage(out);
    expect(branch).toMatch(/^package\//);
    expect(manifest.counts.adds).toBe(1);

    const preview = b.previewMerge(branch);
    expect(preview.conflicts).toEqual([]); // receiver untouched since the shared base
    expect(preview.adds.map((x: any) => x.id)).toEqual([added.id]);
    expect(preview.edits.map((x: any) => x.id)).toEqual([shared.id]);
    expect(preview.deletes.map((x: any) => x.id)).toEqual([doomed.id]);
    expect(preview.fileChanges).toEqual([{ id: added.id, puts: ['photo.jpg'], deletes: [] }]);

    const result = b.mergeBranchLocally(branch);
    expect(result.merged).toBe(3);
    expect(result.files.put).toBe(1);
    expect(b.get(shared.id).value).toBe('shared doc v2');
    expect(b.get(added.id).value).toBe('brand new');
    expect(b.get(doomed.id)).toBeNull();
    expect(b.getFile(added.id, 'photo.jpg')).toEqual(Buffer.from('jpeg-bytes'));

    fs.rmSync(out); cleanup(a); cleanup(b);
  });

  test('cross-datastore conflict detection rides the content fingerprints, not clocks', () => {
    const { a, b, shared } = senderAndReceiver();
    a.createBranch('outbox');
    a.useBranch('outbox');
    a.update(shared.id, { value: 'sender version' });
    const out = path.join(os.tmpdir(), `test-cf-${Date.now()}.kanecta-package`);
    a.exportPackage('outbox', out);

    // The receiver moved the same item AFTER the shared base — a genuine
    // cross-org conflict no timestamp comparison could see (different clocks,
    // no shared branchPoint).
    b.update(shared.id, { value: 'receiver version' });

    const { branch } = b.importPackage(out);
    const preview = b.previewMerge(branch);
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0]).toMatchObject({ id: shared.id, kind: 'edit-edit' });
    expect(() => b.mergeBranchLocally(branch)).toThrow(/conflict/);

    // Human resolution: sender wins.
    const result = b.mergeBranchLocally(branch, { strategy: 'theirs' });
    expect(result.merged).toBe(1);
    expect(b.get(shared.id).value).toBe('sender version');

    fs.rmSync(out); cleanup(a); cleanup(b);
  });

  test('importPackage rejects foreign formats, bad versions, and zip-slip paths', () => {
    const { a, b } = senderAndReceiver();

    const notPackage = new AdmZip();
    notPackage.addFile('whatever.txt', Buffer.from('x'));
    const p1 = path.join(os.tmpdir(), `test-np-${Date.now()}.zip`);
    notPackage.writeZip(p1);
    expect(() => b.importPackage(p1)).toThrow(/manifest\.json missing/);

    const evil = new AdmZip();
    evil.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'kanecta-package', formatVersion: '0.1' })));
    evil.addFile('items/../../../../escape.txt', Buffer.from('gotcha'));
    const p2 = path.join(os.tmpdir(), `test-evil-${Date.now()}.zip`);
    evil.writeZip(p2);
    expect(() => b.importPackage(p2, { name: 'package/evil' })).toThrow(/unsafe entry path/);
    // The half-imported branch was cleaned up.
    expect(b.listBranches().map((x: any) => x.name)).not.toContain('package/evil');

    const badVersion = new AdmZip();
    badVersion.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'kanecta-package', formatVersion: '9.9' })));
    const p3 = path.join(os.tmpdir(), `test-bv-${Date.now()}.zip`);
    badVersion.writeZip(p3);
    expect(() => b.importPackage(p3)).toThrow(/unsupported formatVersion/);

    for (const p of [p1, p2, p3]) fs.rmSync(p);
    cleanup(a); cleanup(b);
  });

  test('user-defined type items travel with the package (add on a receiver that lacks the type)', () => {
    const { a, b } = senderAndReceiver();
    // Sender defines a type ON MAIN (so it is upstream of the branch), then
    // adds an instance on the branch.
    const { metadata: typeItem } = a.createType('invoice', {
      schema: {
        meta: { icon: '🧾', description: 'an invoice', details: '', keywords: '', tags: '', 'ai-instructions': { claude: '' } },
        jsonSchema: {
          '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '', title: 'invoice',
          type: 'object',
          properties: { total: { type: 'number', 'x-id': '33333333-3333-4333-8333-000000000001' } },
          required: [], additionalProperties: false,
        },
      },
    });
    a.createBranch('outbox');
    a.useBranch('outbox');
    const inst = a.create({ value: 'INV-1', type: 'object', typeId: typeItem.id, parentId: typeItem.id, objectData: { total: 42 } });

    const out = path.join(os.tmpdir(), `test-ty-${Date.now()}.kanecta-package`);
    const { manifest } = a.exportPackage('outbox', out);
    expect(manifest.requires.typeIds).toContain(typeItem.id);

    const { branch } = b.importPackage(out);
    const preview = b.previewMerge(branch);
    // Both the instance AND the type item arrive as adds (receiver lacks both).
    expect(preview.adds.map((x: any) => x.id).sort()).toEqual([inst.id, typeItem.id].sort());
    b.mergeBranchLocally(branch);
    expect(b.get(typeItem.id)?.value).toBe('invoice');
    expect(b.readObjectJson(inst.id)).toMatchObject({ total: 42 });

    fs.rmSync(out); cleanup(a); cleanup(b);
  });
});
