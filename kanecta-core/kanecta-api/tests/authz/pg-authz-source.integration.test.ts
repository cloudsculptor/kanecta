// PgAuthzSource against real Postgres: the visibility + owner read layers the
// G4 engine decides on, backed by the items table. Gated on KANECTA_TEST_PG_URL.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { can } from '../../src/authz/index.ts';
import { PgAuthzSource } from '../../src/authz/pg-authz-source.ts';

const PG_URL = process.env.KANECTA_TEST_PG_URL;
const SCHEMA = 'kanecta_pg_authz_test';
const run = PG_URL ? describe : describe.skip;

const PUB = 'bb000000-0000-4000-8000-000000000001';
const PRIV = 'bb000000-0000-4000-8000-000000000002';
const ORG = 'bb000000-0000-4000-8000-000000000003';
const GONE = 'bb000000-0000-4000-8000-0000000000ff';

run('PgAuthzSource (real Postgres)', () => {
  let admin: Pool;
  let pool: Pool;
  let authz: PgAuthzSource;

  beforeAll(async () => {
    admin = new Pool({ connectionString: PG_URL });
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    pool = new Pool({ connectionString: PG_URL, options: `-c search_path="${SCHEMA}"` });
    await pool.query(`CREATE TABLE items (
      id uuid PRIMARY KEY, parent_id uuid, owner varchar(255), visibility varchar(20), deleted_at timestamptz)`);
    await pool.query(`INSERT INTO items (id, owner, visibility) VALUES
      ($1,'u-alice','public'), ($2,'u-alice','private'), ($3,'u-alice','organisation')`, [PUB, PRIV, ORG]);
    authz = new PgAuthzSource(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); await admin.end(); }
  });

  it('public items are readable by anyone (even with no principals)', async () => {
    expect(await can(authz, [], PUB, 'read')).toBe(true);
    expect(await can(authz, ['u-bob'], PUB, 'read')).toBe(true);
  });

  it('private items: the owner reads, a non-owner is denied', async () => {
    expect(await can(authz, ['u-alice'], PRIV, 'read')).toBe(true);
    expect(await can(authz, ['u-bob'], PRIV, 'read')).toBe(false);
  });

  it('organisation items: readable only with inOrganisation', async () => {
    expect(await can(authz, ['u-bob'], ORG, 'read', { inOrganisation: true })).toBe(true);
    expect(await can(authz, ['u-bob'], ORG, 'read', { inOrganisation: false })).toBe(false);
    // owner still reads regardless of org membership
    expect(await can(authz, ['u-alice'], ORG, 'read')).toBe(true);
  });

  it('a missing (or soft-deleted) item is denied', async () => {
    expect(await can(authz, ['u-alice'], GONE, 'read')).toBe(false);
    await pool.query(`UPDATE items SET deleted_at = now() WHERE id = $1`, [PUB]);
    expect(await can(authz, ['u-bob'], PUB, 'read')).toBe(false); // resolveItem skips deleted
    await pool.query(`UPDATE items SET deleted_at = NULL WHERE id = $1`, [PUB]);
  });
});
