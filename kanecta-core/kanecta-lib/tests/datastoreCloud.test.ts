'use strict';

// Tests for the remote-only working set (G6): a composite `cloud` origin remote
// pairing Postgres (items) + S3 (files) resolves through the facade to a cloud
// datastore.
//
// These are the deterministic unit tests for the config→cloudConfig translation
// and the `openWorkingSet` dispatch (no infra). The LIVE round-trip against dev
// Postgres + MinIO is verified separately by `scripts/verify-cloud-working-set.ts`
// (run via tsx) — it can't live here because the Postgres adapter's migration
// loader uses `__dirname`, which vitest's ESM module runner does not provide when
// the adapter is opened in-process from another package's test. The real consumers
// (kanecta-api/mcp/cli) run under node/tsx, where `__dirname` resolves, so the tsx
// script is the faithful end-to-end check.
import { Datastore, cloudConfigFromRemote, buildPgConnectionString } from '../src/index.ts';

// ─── buildPgConnectionString ────────────────────────────────────────────────

test('buildPgConnectionString assembles a postgres:// URL from discrete fields', () => {
  const cs = buildPgConnectionString({
    host: 'db.example.com', port: 25061, database: 'kanecta_internal',
    user: 'richie_ki', password: 'p@ss:word/1',
  });
  // user + password are URL-encoded so special characters don't break the URL
  expect(cs).toBe('postgres://richie_ki:p%40ss%3Aword%2F1@db.example.com:25061/kanecta_internal');
});

test('buildPgConnectionString defaults the port to 5432 and omits empty passwords', () => {
  expect(buildPgConnectionString({ host: 'h', database: 'd', user: 'u' }))
    .toBe('postgres://u@h:5432/d');
  expect(buildPgConnectionString({ host: 'h', database: 'd', user: 'u', password: '' }))
    .toBe('postgres://u@h:5432/d');
});

test('buildPgConnectionString throws on missing host/database/user', () => {
  expect(() => buildPgConnectionString({ database: 'd', user: 'u' })).toThrow(/host/);
  expect(() => buildPgConnectionString({ host: 'h', user: 'u' })).toThrow(/database/);
  expect(() => buildPgConnectionString({ host: 'h', database: 'd' })).toThrow(/user/);
});

// ─── cloudConfigFromRemote ──────────────────────────────────────────────────

const S3_BLOCK = {
  endpoint: 'http://localhost:45900', region: 'us-east-1',
  accessKeyId: 'kanecta', secretAccessKey: 'secret', bucket: 'kanecta',
};

test('cloudConfigFromRemote maps a cloud remote to an openCloud cloudConfig', () => {
  const cfg = cloudConfigFromRemote({
    type: 'cloud',
    postgres: { host: 'h', port: 45432, database: 'kanecta', user: 'kanecta', password: 'kanecta', ssl: true },
    s3: S3_BLOCK,
  });
  expect(cfg.pg.connectionString).toBe('postgres://kanecta:kanecta@h:45432/kanecta');
  expect(cfg.pg.ssl).toBe(true);
  expect(cfg.s3).toEqual(S3_BLOCK);
});

test('cloudConfigFromRemote omits pg.ssl when not requested', () => {
  const cfg = cloudConfigFromRemote({
    type: 'cloud',
    postgres: { host: 'h', database: 'kanecta', user: 'kanecta' },
    s3: S3_BLOCK,
  });
  expect('ssl' in cfg.pg).toBe(false);
});

test('cloudConfigFromRemote requires both halves of the pair', () => {
  expect(() => cloudConfigFromRemote({ type: 'cloud', s3: S3_BLOCK })).toThrow(/postgres/);
  expect(() => cloudConfigFromRemote({
    type: 'cloud', postgres: { host: 'h', database: 'd', user: 'u' },
  })).toThrow(/s3|files/);
});

// ─── openWorkingSet dispatch (no infra — openCloud is stubbed) ───────────────

test('openWorkingSet routes a remote-only cloud origin to openCloud', async () => {
  const origin = {
    type: 'cloud',
    postgres: { host: 'h', database: 'kanecta', user: 'kanecta', password: 'kanecta' },
    s3: S3_BLOCK,
  };
  const original = Datastore.openCloud;
  let seen: any = null;
  (Datastore as any).openCloud = async (cfg: any) => { seen = cfg; return { sentinel: true }; };
  try {
    const ds = await Datastore.openWorkingSet({ remotes: { origin }, defaultBranch: 'main' });
    expect(ds).toEqual({ sentinel: true });
    expect(seen).toEqual(cloudConfigFromRemote(origin));
  } finally {
    (Datastore as any).openCloud = original;
  }
});

test('openWorkingSet still prefers a local datastore when present', async () => {
  // A working set with BOTH local and remotes uses local (the remote is a mirror),
  // never the cloud branch.
  const original = Datastore.openCloud;
  let cloudCalled = false;
  (Datastore as any).openCloud = async () => { cloudCalled = true; return {}; };
  const originalOpen = Datastore.open;
  (Datastore as any).open = () => ({ useBranch() {} });
  try {
    await Datastore.openWorkingSet({
      local: '/tmp/does-not-matter',
      remotes: { origin: { type: 'cloud', postgres: {}, s3: {} } },
    });
    expect(cloudCalled).toBe(false);
  } finally {
    (Datastore as any).openCloud = original;
    (Datastore as any).open = originalOpen;
  }
});
