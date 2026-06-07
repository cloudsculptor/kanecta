'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const APP_CONFIG_PATH = path.join(os.homedir(), '.config', 'kanecta', 'config.json');

let resolveWorkspace;

beforeEach(() => {
  jest.resetModules();
  delete process.env.KANECTA_DATASTORE;
  delete process.env.KANECTA_WORKSPACE;
  jest.spyOn(fs, 'readFileSync');
  ({ resolveWorkspace } = require('../src/index'));
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.KANECTA_DATASTORE;
  delete process.env.KANECTA_WORKSPACE;
});

function mockAppConfig(cfg) {
  fs.readFileSync.mockImplementation((p, enc) => {
    if (p === APP_CONFIG_PATH) return JSON.stringify(cfg);
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
}

test('returns the default workspace from app config', () => {
  mockAppConfig({ default: 'main', workspaces: { main: { mode: 'FILESYSTEM', datastore: '/data/kanecta' } } });
  expect(resolveWorkspace()).toEqual({ mode: 'FILESYSTEM', datastore: '/data/kanecta' });
});

test('KANECTA_WORKSPACE env var overrides the default', () => {
  process.env.KANECTA_WORKSPACE = 'other';
  mockAppConfig({
    default: 'main',
    workspaces: {
      main: { mode: 'FILESYSTEM', datastore: '/data/main' },
      other: { mode: 'FILESYSTEM', datastore: '/data/other' },
    },
  });
  expect(resolveWorkspace()).toEqual({ mode: 'FILESYSTEM', datastore: '/data/other' });
});

test('throws when the requested workspace is not found', () => {
  mockAppConfig({ default: 'missing', workspaces: { main: { mode: 'FILESYSTEM', datastore: '/data/kanecta' } } });
  expect(() => resolveWorkspace()).toThrow("Workspace 'missing' not found");
});

test('falls back to the single configured workspace when there is no default', () => {
  mockAppConfig({ workspaces: { main: { mode: 'FILESYSTEM', datastore: '/data/kanecta' } } });
  expect(resolveWorkspace()).toEqual({ mode: 'FILESYSTEM', datastore: '/data/kanecta' });
});

test('throws when multiple workspaces are configured and no default/override', () => {
  mockAppConfig({
    workspaces: {
      a: { mode: 'FILESYSTEM', datastore: '/data/a' },
      b: { mode: 'FILESYSTEM', datastore: '/data/b' },
    },
  });
  expect(() => resolveWorkspace()).toThrow('Multiple Kanecta workspaces');
});

test('throws when no workspaces are configured', () => {
  mockAppConfig({ workspaces: {} });
  expect(() => resolveWorkspace()).toThrow('No Kanecta workspaces found');
});
