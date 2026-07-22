'use strict';

// Integration tests for the datastore-utils composition layer — the glue every
// cloud working set goes through (config → Pool/S3Client → PostgresAdapter +
// S3Adapter → CloudAdapter). Previously the package's test script claimed
// "tested via integration" while nothing in the repo imported it.
//
// The Postgres half follows the kanecta-postgres suite's convention: the dev
// pg at localhost:45432 (KANECTA_TEST_PG_URL to override), one throwaway
// schema per run. The S3 half runs only when KANECTA_TEST_S3_SECRET is set,
// mirroring the kanecta-s3 suite — items-side assertions don't need it.

import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  openFilesystemAdapter,
  forgetFilesystemAdapter,
  createFilesystemAdapter,
} from '../src/index';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const S3_SECRET = process.env.KANECTA_TEST_S3_SECRET;


describe('filesystem adapter interning', () => {
  test('same path → same instance; forget() drops it; embeddings option bypasses the cache', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsutils-intern-'));
    try {
      createFilesystemAdapter(root, 'test@example.com');
      const a = openFilesystemAdapter(root);
      const b = openFilesystemAdapter(root);
      expect(b).toBe(a);

      // An options-carrying open gets its own uncached handle…
      const c = openFilesystemAdapter(root, { embeddings: { provider: 'mock', dimensions: 8 } });
      expect(c).not.toBe(a);
      // …and the interned plain instance is untouched.
      expect(openFilesystemAdapter(root)).toBe(a);

      forgetFilesystemAdapter(root);
      const d = openFilesystemAdapter(root);
      expect(d).not.toBe(a);
    } finally {
      forgetFilesystemAdapter(root);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('cloud adapter composition (config → CloudAdapter)', () => {
  // The composition chain is CJS-shaped TS (main: src/index.ts, no "type"
  // field) that vite-node's ESM transform can't load (__dirname in the pg
  // adapter's migrations loader). Production runs it under tsx — so the test
  // does too: a tsx child process runs the full round-trip (create item →
  // reopen → get → relTypes getter → createBranch/listBranches → search →
  // optional S3 file round-trip) against the dev pg and prints one JSON line.
  test('config → CloudAdapter round-trip under the production loader (tsx)', () => {
    // vitest runs with cwd = the package root; avoid __dirname/import.meta
    // (module-format-dependent under vite-node / NodeNext).
    const script = path.join(process.cwd(), 'tests', 'cloud-compose-script.ts');
    const res = execFileSync('npx', ['tsx', script], { encoding: 'utf8', timeout: 120_000 });
    const lines = res.trim().split('\n');
    const out = JSON.parse(lines[lines.length - 1]);
    expect(out).toMatchObject({
      ok: true,
      reopenedValue: 'through the glue',
      relTypesIsArray: true,
      branchCreated: true,
      searchFoundItem: true,
    });
    expect(out.createdId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.branchCount).toBeGreaterThan(0);
    if (S3_SECRET) expect(out.fileRoundTrip).toBe(true);
  }, 120_000);
});
