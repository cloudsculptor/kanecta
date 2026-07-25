'use strict';

// CloudAdapter is a pure composition proxy: items methods → the Postgres-backed
// items adapter, file methods → the S3 files adapter. Its one failure mode is a
// method MISSING from the whitelist — then a cloud working set throws
// 'this._items.x is not a function' in production the first time anything
// (Studio branching, /transaction, search…) calls it. The parity test below
// turns that failure mode into a CI failure.

import { describe, test, expect } from 'vitest';
import { CloudAdapter } from '../src/adapter';
import { PostgresAdapter } from '@kanecta/database';

// The Postgres adapter's public callable surface: prototype methods, minus the
// constructor, minus private (_-prefixed) helpers. No pool needed — this is
// pure reflection on the class.
function postgresPublicMethods(): string[] {
  return Object.getOwnPropertyNames(PostgresAdapter.prototype)
    .filter((name) => {
      if (name === 'constructor' || name.startsWith('_')) return false;
      const desc = Object.getOwnPropertyDescriptor(PostgresAdapter.prototype, name);
      return typeof desc?.value === 'function'; // methods only; getters checked separately
    });
}

function postgresPublicGetters(): string[] {
  return Object.getOwnPropertyNames(PostgresAdapter.prototype)
    .filter((name) => {
      if (name.startsWith('_')) return false;
      const desc = Object.getOwnPropertyDescriptor(PostgresAdapter.prototype, name);
      return typeof desc?.get === 'function';
    });
}

describe('CloudAdapter ↔ PostgresAdapter surface parity', () => {
  test('every public Postgres method exists on CloudAdapter', () => {
    const missing = postgresPublicMethods().filter(
      (name) => typeof (CloudAdapter.prototype as any)[name] !== 'function',
    );
    // A name here means: extend ITEM_METHODS in src/adapter.ts. A cloud
    // working set currently CRASHES when this method is called on it.
    expect(missing).toEqual([]);
  });

  test('every public Postgres getter reads through on CloudAdapter', () => {
    const missing = postgresPublicGetters().filter((name) => {
      const desc = Object.getOwnPropertyDescriptor(CloudAdapter.prototype, name);
      return typeof desc?.get !== 'function';
    });
    expect(missing).toEqual([]);
  });
});

describe('CloudAdapter forwarding', () => {
  function stubPair() {
    const calls: Array<[string, any[]]> = [];
    const record = (target: string) =>
      new Proxy({}, {
        get: (_o, prop: string) => {
          if (prop === 'embeddingsEnabled') return true;
          if (prop === 'transactionMode') return 'async';
          if (prop === 'config') return { owner: 'stub' };
          return (...args: any[]) => { calls.push([`${target}.${prop}`, args]); return `${target}:${prop}`; };
        },
      });
    return { items: record('items'), files: record('files'), calls };
  }

  test('item methods hit the items adapter, file methods the files adapter', async () => {
    const { items, files, calls } = stubPair();
    const cloud = await CloudAdapter.open({ items, files });

    expect(cloud.createBranch('feature/x')).toBe('items:createBranch');
    expect(cloud.search('q', { limit: 5 })).toBe('items:search');
    expect(cloud.unrelate('rel-1')).toBe('items:unrelate');
    expect(cloud.putFile('id', 'a.png', Buffer.from('x'))).toBe('files:putFile');
    expect(cloud.getFile('id', 'a.png')).toBe('files:getFile');

    expect(calls.map(([name]) => name)).toEqual([
      'items.createBranch', 'items.search', 'items.unrelate', 'files.putFile', 'files.getFile',
    ]);
    // Args pass through verbatim.
    expect(calls[1][1]).toEqual(['q', { limit: 5 }]);
  });

  test('getter passthroughs read the items adapter', async () => {
    const { items, files } = stubPair();
    const cloud = await CloudAdapter.open({ items, files });
    expect(cloud.embeddingsEnabled).toBe(true);
    expect(cloud.transactionMode).toBe('async');
    expect(cloud.config).toEqual({ owner: 'stub' });
  });
});
