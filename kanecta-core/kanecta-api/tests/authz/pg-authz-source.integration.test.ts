// PgAuthzSource against real Postgres: the full generic authz stack the G4 engine
// decides on — visibility + owner + GRANT items (direct + cascading up the container
// tree) + role/namespace principals + permission implication. Gated on
// KANECTA_TEST_PG_URL. Nothing here is community-hub-specific.

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
const CONT = 'bb000000-0000-4000-8000-000000000010'; // a container
const CHILD = 'bb000000-0000-4000-8000-000000000011'; // private item under CONT
const OUTSIDE = 'bb000000-0000-4000-8000-000000000012'; // private item NOT under CONT
const GONE = 'bb000000-0000-4000-8000-0000000000ff';

// grant items
const G_DIRECT = 'cc000000-0000-4000-8000-000000000001'; // u-bob read on PRIV (no cascade)
const G_TEAM = 'cc000000-0000-4000-8000-000000000002';   // role/team read on CONT (cascade)
const G_MOD = 'cc000000-0000-4000-8000-000000000003';    // role/moderator admin on CONT (cascade)
const G_NOCAS = 'cc000000-0000-4000-8000-000000000004';  // role/x read on CONT (NO cascade)

run('PgAuthzSource (real Postgres) — visibility + owner + grants', () => {
  let admin: Pool;
  let pool: Pool;
  let authz: PgAuthzSource;

  beforeAll(async () => {
    admin = new Pool({ connectionString: PG_URL });
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    pool = new Pool({ connectionString: PG_URL, options: `-c search_path="${SCHEMA}"` });
    await pool.query(`CREATE TABLE items (
      id uuid PRIMARY KEY, parent_id uuid, type varchar(50) NOT NULL DEFAULT 'object',
      owner varchar(255), visibility varchar(20), deleted_at timestamptz)`);
    await pool.query(`CREATE TABLE item_payloads (item_id uuid PRIMARY KEY, payload jsonb NOT NULL)`);
    await pool.query(`CREATE INDEX ON item_payloads ((payload->>'governedItemId'))`);

    await pool.query(`INSERT INTO items (id, parent_id, owner, visibility) VALUES
      ($1,NULL,'u-alice','public'), ($2,NULL,'u-alice','private'), ($3,NULL,'u-alice','organisation'),
      ($4,NULL,'u-alice','private'), ($5,$4,'u-alice','private'), ($6,NULL,'u-alice','private')`,
      [PUB, PRIV, ORG, CONT, CHILD, OUTSIDE]);

    // grant items (type='grant') + their payloads in item_payloads.
    const grant = (id: string, gov: string, principal: string, perms: string[], cascade: boolean) => [
      pool.query(`INSERT INTO items (id, parent_id, type, owner, visibility) VALUES ($1,NULL,'grant','u-alice','private')`, [id]),
      pool.query(`INSERT INTO item_payloads (item_id, payload) VALUES ($1,$2)`,
        [id, JSON.stringify({ governedItemId: gov, principal, permissions: perms, cascade })]),
    ];
    await Promise.all([
      ...grant(G_DIRECT, PRIV, 'u-bob', ['read'], false),
      ...grant(G_TEAM, CONT, 'role/team', ['read'], true),
      ...grant(G_MOD, CONT, 'role/moderator', ['admin'], true),
      ...grant(G_NOCAS, CONT, 'role/x', ['read'], false),
    ]);

    authz = new PgAuthzSource(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); await admin.end(); }
  });

  it('visibility + owner: public→anyone, private→owner-only, org→in-org', async () => {
    expect(await can(authz, [], PUB, 'read')).toBe(true);
    expect(await can(authz, ['u-alice'], PRIV, 'read')).toBe(true);
    expect(await can(authz, ['u-carol'], PRIV, 'read')).toBe(false);
    expect(await can(authz, ['u-bob'], ORG, 'read', { inOrganisation: true })).toBe(true);
    expect(await can(authz, ['u-bob'], ORG, 'read', { inOrganisation: false })).toBe(false);
  });

  it('a DIRECT grant lets a non-owner read a private item', async () => {
    expect(await can(authz, ['u-bob'], PRIV, 'read')).toBe(true);   // via G_DIRECT
    expect(await can(authz, ['u-carol'], PRIV, 'read')).toBe(false); // no grant
  });

  it('a CASCADE grant on a container flows to items inside it', async () => {
    // role/team has read on CONT with cascade → can read CHILD (under CONT)…
    expect(await can(authz, ['role/team'], CHILD, 'read')).toBe(true);
    // …but not an item outside the container.
    expect(await can(authz, ['role/team'], OUTSIDE, 'read')).toBe(false);
  });

  it('a NON-cascade grant applies to the item itself, not its descendants', async () => {
    expect(await can(authz, ['role/x'], CONT, 'read')).toBe(true);   // direct on CONT
    expect(await can(authz, ['role/x'], CHILD, 'read')).toBe(false); // does not cascade
  });

  it('permission implication: an admin grant satisfies a read', async () => {
    expect(await can(authz, ['role/moderator'], CHILD, 'read')).toBe(true); // admin ⊇ read, cascaded
    expect(await can(authz, ['role/moderator'], CHILD, 'write')).toBe(true); // admin ⊇ write
  });

  it('a missing / soft-deleted item is denied', async () => {
    expect(await can(authz, ['u-alice'], GONE, 'read')).toBe(false);
    await pool.query(`UPDATE items SET deleted_at = now() WHERE id = $1`, [PUB]);
    expect(await can(authz, ['u-bob'], PUB, 'read')).toBe(false);
    await pool.query(`UPDATE items SET deleted_at = NULL WHERE id = $1`, [PUB]);
  });
});
