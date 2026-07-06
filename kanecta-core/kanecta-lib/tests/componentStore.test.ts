'use strict';

import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  resolveComponentStore,
} from '../src/appConfig.ts';
import {
  storePath, packageDir, isInstalled, installFromDir, syncFromSource, listInstalled, readComponentItem,
} from '../src/componentStore.ts';

let tmp;
let store;
let source;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-compstore-'));
  store = path.join(tmp, 'store');
  source = path.join(tmp, 'src');
  fs.mkdirSync(source, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.KANECTA_COMPONENT_STORE;
});

function makeComponent(dir, name, version, id) {
  const d = path.join(source, dir);
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, version, private: true, main: 'src/index.ts' }));
  fs.writeFileSync(path.join(d, 'kanecta.item.json'), JSON.stringify({
    item: { id, parentId: '00000000-0000-0000-0000-000000000000', type: 'component', value: dir },
    meta: { files: { body: 'src/index.ts' } },
    payload: { props: [] },
  }));
  fs.writeFileSync(path.join(d, 'src', 'index.ts'), `export const X = '${name}';\n`);
  // Noise that must be excluded from the copy:
  fs.mkdirSync(path.join(d, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(d, 'node_modules', 'junk.js'), 'nope');
  return d;
}

describe('resolveComponentStore', () => {
  test('honours the KANECTA_COMPONENT_STORE env override', () => {
    process.env.KANECTA_COMPONENT_STORE = '/tmp/my-store';
    expect(resolveComponentStore()).toBe('/tmp/my-store');
  });

  test('honours config.componentStore when no env override', () => {
    expect(resolveComponentStore({ componentStore: '/opt/kanecta/components' })).toBe('/opt/kanecta/components');
  });

  test('falls back to a platform default under the OS cache dir', () => {
    const p = resolveComponentStore({});
    expect(p.endsWith(path.join('kanecta', 'components'))).toBe(true);
  });
});

describe('installFromDir', () => {
  test('copies a package to <store>/<name>@<version> and excludes node_modules', () => {
    const src = makeComponent('kanecta-component-a', '@kanecta/component-a', '1.4.0', '11111111-1111-4111-8111-111111111111');
    const res = installFromDir(src, { store });
    expect(res).toMatchObject({ name: '@kanecta/component-a', version: '1.4.0', installed: true });
    expect(res.dir).toBe(packageDir(store, '@kanecta/component-a', '1.4.0'));
    expect(fs.existsSync(path.join(res.dir, 'kanecta.item.json'))).toBe(true);
    expect(fs.existsSync(path.join(res.dir, 'src', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(res.dir, 'node_modules'))).toBe(false); // excluded
  });

  test('is idempotent (skips an already-installed version)', () => {
    const src = makeComponent('kanecta-component-a', '@kanecta/component-a', '1.4.0', '11111111-1111-4111-8111-111111111111');
    expect(installFromDir(src, { store }).installed).toBe(true);
    expect(isInstalled('@kanecta/component-a', '1.4.0', { store })).toBe(true);
    expect(installFromDir(src, { store }).installed).toBe(false);
  });

  test('force re-installs', () => {
    const src = makeComponent('kanecta-component-a', '@kanecta/component-a', '1.4.0', '11111111-1111-4111-8111-111111111111');
    installFromDir(src, { store });
    expect(installFromDir(src, { store, force: true }).installed).toBe(true);
  });
});

describe('syncFromSource + listInstalled + readComponentItem', () => {
  test('installs every component package under the source root and lists them', () => {
    makeComponent('kanecta-component-a', '@kanecta/component-a', '1.4.0', '11111111-1111-4111-8111-111111111111');
    makeComponent('kanecta-component-b', '@kanecta/component-b', '2.0.0', '22222222-2222-4222-8222-222222222222');
    // A non-component dir (no kanecta.item.json) must be ignored.
    fs.mkdirSync(path.join(source, 'not-a-component'), { recursive: true });
    fs.writeFileSync(path.join(source, 'not-a-component', 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));

    const results = syncFromSource(source, { store });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual(['@kanecta/component-a', '@kanecta/component-b']);

    const installed = listInstalled({ store });
    expect(installed).toEqual([
      { name: '@kanecta/component-a', version: '1.4.0', dir: packageDir(store, '@kanecta/component-a', '1.4.0') },
      { name: '@kanecta/component-b', version: '2.0.0', dir: packageDir(store, '@kanecta/component-b', '2.0.0') },
    ]);

    const item = readComponentItem('@kanecta/component-a', '1.4.0', { store });
    expect(item.item.type).toBe('component');
    expect(item.item.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  test('multiple versions of the same package coexist in the store', () => {
    makeComponent('a1', '@kanecta/component-a', '1.4.0', '11111111-1111-4111-8111-111111111111');
    makeComponent('a2', '@kanecta/component-a', '1.5.0', '11111111-1111-4111-8111-111111111111');
    syncFromSource(source, { store });
    const versions = listInstalled({ store }).filter((p) => p.name === '@kanecta/component-a').map((p) => p.version);
    expect(versions.sort()).toEqual(['1.4.0', '1.5.0']);
  });

  test('storePath resolves without throwing', () => {
    expect(typeof storePath({ componentStore: store })).toBe('string');
  });
});
