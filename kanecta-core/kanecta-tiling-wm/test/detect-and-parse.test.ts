import { test } from 'node:test';
import assert from 'node:assert';
import os from 'os';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { detectTiling } from '../src/detect.js';
import { windowsFromTree } from '../src/client.js';
import { createTilingService, TilingUnavailableError } from '../src/index.js';

test('detectTiling prefers $SWAYSOCK when the socket exists', async () => {
  const sockPath = path.join(os.tmpdir(), `tiling-test-${process.pid}.sock`);
  try { fs.unlinkSync(sockPath); } catch { /* noop */ }
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(sockPath, () => r()));
  try {
    const got = detectTiling({ SWAYSOCK: sockPath });
    assert.deepStrictEqual(got, { variant: 'sway', socketPath: sockPath });
  } finally {
    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* noop */ }
  }
});

test('detectTiling returns null when nothing is set/running', () => {
  // Empty env + a bogus PATH so `i3`/`swaymsg` cannot be found.
  const got = detectTiling({ PATH: '/nonexistent-bin-dir' });
  assert.strictEqual(got, null);
});

test('createTilingService reports unavailable gracefully (no throw)', async () => {
  const svc = await createTilingService({ PATH: '/nonexistent-bin-dir' });
  assert.strictEqual(svc.available, false);
  assert.strictEqual(svc.client, null);
  assert.ok(typeof svc.reason === 'string' && svc.reason.length > 0);
});

test('TilingUnavailableError is exported and typed', () => {
  const e = new TilingUnavailableError('x');
  assert.strictEqual(e.code, 'TILING_UNAVAILABLE');
  assert.ok(e instanceof Error);
});

test('windowsFromTree flattens i3 (window) and Sway (app_id) leaves with context', () => {
  // A minimal GET_TREE: root → output → workspace → { split → two leaves }.
  const tree = {
    type: 'root', name: 'root', nodes: [{
      type: 'output', name: 'HDMI-1', nodes: [{
        type: 'workspace', name: '1: web', nodes: [{
          type: 'con', // a split container (not a window)
          nodes: [
            { type: 'con', id: 101, name: 'Firefox', window: 4194305, window_properties: { class: 'firefox' }, pid: 111, focused: true, nodes: [] },
            { type: 'con', id: 102, name: 'Terminal', app_id: 'foot', pid: 222, nodes: [] },
          ],
          floating_nodes: [],
        }],
        floating_nodes: [],
      }],
      floating_nodes: [],
    }],
    floating_nodes: [],
  };
  const windows = windowsFromTree(tree);
  assert.strictEqual(windows.length, 2);

  const ff = windows.find((w) => w.id === 101);
  assert.ok(ff);
  assert.strictEqual(ff.name, 'Firefox');
  assert.strictEqual(ff.windowClass, 'firefox');
  assert.strictEqual(ff.workspace, '1: web');
  assert.strictEqual(ff.output, 'HDMI-1');
  assert.strictEqual(ff.focused, true);

  const term = windows.find((w) => w.id === 102);
  assert.ok(term);
  assert.strictEqual(term.appId, 'foot');
  assert.strictEqual(term.workspace, '1: web');

  // The split container itself is not a window.
  assert.ok(!windows.some((w) => w.id == null));
});
