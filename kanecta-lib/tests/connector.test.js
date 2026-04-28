'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { KanectaConnector } = require('../src/index');

const SAMPLE_DATASTORE = path.resolve(__dirname, '../../kanecta-datastore-sample');

// Use a temp datastore for write tests so we don't mutate the sample
function makeTempDatastore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-test-'));
  const configDir = path.join(tmp, '.kanecta', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ owner: 'test@example.com' })
  );
  return tmp;
}

describe('KanectaConnector — reads (sample datastore)', () => {
  let connector;

  beforeAll(() => {
    connector = new KanectaConnector({ datastorePath: SAMPLE_DATASTORE });
  });

  test('listRoots returns items with no parentId', async () => {
    const roots = await connector.listRoots();
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.every((r) => r.parentId === null)).toBe(true);
  });

  test('getItem returns a known item', async () => {
    const roots = await connector.listRoots();
    const item = await connector.getItem(roots[0].id);
    expect(item.id).toBe(roots[0].id);
  });

  test('getChildren returns sorted children', async () => {
    const roots = await connector.listRoots();
    const children = await connector.getChildren(roots[0].id);
    for (let i = 1; i < children.length; i++) {
      expect(children[i].sortOrder).toBeGreaterThanOrEqual(children[i - 1].sortOrder);
    }
  });

  test('getTree returns nested structure', async () => {
    const roots = await connector.listRoots();
    const tree = await connector.getTree(roots[0].id, { depth: 2 });
    expect(tree.id).toBe(roots[0].id);
    expect(Array.isArray(tree.children)).toBe(true);
  });
});

describe('KanectaConnector — writes (temp datastore)', () => {
  let connector;
  let datastorePath;

  beforeEach(() => {
    datastorePath = makeTempDatastore();
    connector = new KanectaConnector({ datastorePath });
  });

  afterEach(() => {
    fs.rmSync(datastorePath, { recursive: true, force: true });
  });

  test('addItem creates a root item', async () => {
    const item = await connector.addItem({ value: 'Hello world', type: 'string' });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.value).toBe('Hello world');
    expect(item.parentId).toBeNull();
    expect(item.owner).toBe('test@example.com');

    const fetched = await connector.getItem(item.id);
    expect(fetched.id).toBe(item.id);
  });

  test('addItem auto-increments sortOrder', async () => {
    const a = await connector.addItem({ value: 'A' });
    const b = await connector.addItem({ value: 'B' });
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
  });

  test('updateItem changes value', async () => {
    const item = await connector.addItem({ value: 'original' });
    const updated = await connector.updateItem(item.id, { value: 'changed' });
    expect(updated.value).toBe('changed');

    const fetched = await connector.getItem(item.id);
    expect(fetched.value).toBe('changed');
  });

  test('deleteItem removes the item', async () => {
    const item = await connector.addItem({ value: 'to delete' });
    await connector.deleteItem(item.id);
    await expect(connector.getItem(item.id)).rejects.toThrow('Item not found');
  });

  test('deleteItem throws if backlinks exist unless force', async () => {
    const target = await connector.addItem({ value: 'target' });
    await connector.addItem({ value: `see [[${target.id}]]` });

    await expect(connector.deleteItem(target.id)).rejects.toThrow('backlink');
    await expect(connector.deleteItem(target.id, { force: true })).resolves.toBeUndefined();
  });

  test('moveItem changes parentId', async () => {
    const parent = await connector.addItem({ value: 'parent' });
    const child = await connector.addItem({ value: 'child' });
    expect(child.parentId).toBeNull();

    const moved = await connector.moveItem(child.id, { parentId: parent.id });
    expect(moved.parentId).toBe(parent.id);

    const children = await connector.getChildren(parent.id);
    expect(children.some((c) => c.id === child.id)).toBe(true);
  });
});
