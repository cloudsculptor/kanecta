'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const APP_CONFIG_PATH = path.join(os.homedir(), '.config', 'kanecta', 'config.json');

let resolveDatastorePath;

beforeEach(() => {
  jest.resetModules();
  delete process.env.KANECTA_DATASTORE;
  jest.spyOn(fs, 'readFileSync');
  ({ resolveDatastorePath } = require('../src/index'));
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.KANECTA_DATASTORE;
});

function mockAppConfig(cfg) {
  fs.readFileSync.mockImplementation((p, enc) => {
    if (p === APP_CONFIG_PATH) return JSON.stringify(cfg);
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
}

test('returns KANECTA_DATASTORE env var, expanding ~', () => {
  process.env.KANECTA_DATASTORE = '~/my-store';
  expect(resolveDatastorePath()).toBe(path.join(os.homedir(), 'my-store'));
});

test('returns the single configured datastore from app config', () => {
  mockAppConfig({ datastores: ['/data/kanecta'] });
  expect(resolveDatastorePath()).toBe('/data/kanecta');
});

test('throws when multiple datastores are configured and no env var', () => {
  mockAppConfig({ datastores: ['/data/store-a', '/data/store-b'] });
  expect(() => resolveDatastorePath()).toThrow('Multiple Kanecta datastores');
});

test('throws when no datastores are configured and no env var', () => {
  mockAppConfig({ datastores: [] });
  expect(() => resolveDatastorePath()).toThrow('No Kanecta datastores found');
});
