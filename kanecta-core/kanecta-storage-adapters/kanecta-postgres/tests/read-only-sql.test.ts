// runReadOnlySql — integration tests against a real Postgres instance.
//
// The read-only SQL surface (spec §queryPayload) binds {{params.x}} placeholders
// as real SQL parameters and runs the statement inside a READ ONLY transaction
// with a statement timeout — safety lives in the database, not in string
// inspection of the expression.
//
// Same harness as adapter.test.ts: a per-run schema so nothing real is touched.

import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PostgresAdapter, ROOT_ID } from '../src/adapter';

const CONNECTION_STRING =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const OWNER = 'test@example.com';

const SCHEMA = `kanecta_test_${crypto.randomBytes(4).toString('hex')}`;

let adminPool;
let pool;
let adapter;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: CONNECTION_STRING });
  await adminPool.query(`CREATE SCHEMA "${SCHEMA}"`);
  pool    = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${SCHEMA}"` });
  adapter = await PostgresAdapter.init(pool, OWNER);

  await adapter.create({ parentId: ROOT_ID, type: 'text', value: 'ro-alpha' });
  await adapter.create({ parentId: ROOT_ID, type: 'text', value: 'ro-beta' });
  await adapter.create({ parentId: ROOT_ID, type: 'url', value: 'https://example.com/ro' });
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await adminPool.end();
  }
});

describe('runReadOnlySql', () => {
  test('executes a parameterised SELECT with typed columns', async () => {
    const result = await adapter.runReadOnlySql(
      `SELECT id, type, value FROM items WHERE type = {{params.t}} AND value LIKE 'ro-%' ORDER BY value`,
      { t: 'text' },
    );
    expect(result.rows.map((r) => r.value)).toEqual(['ro-alpha', 'ro-beta']);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'type', 'value']);
    expect(result.columns.find((c) => c.name === 'id').dataType).toBe('uuid');
    expect(result.columns.find((c) => c.name === 'value').dataType).toBe('text');
  });

  test('reuses one binding for a repeated placeholder name', async () => {
    const result = await adapter.runReadOnlySql(
      `SELECT value FROM items WHERE value = {{params.v}} OR value = {{params.v}}`,
      { v: 'ro-alpha' },
    );
    expect(result.rows).toEqual([{ value: 'ro-alpha' }]);
  });

  test('enforces the row cap and reports truncation', async () => {
    const result = await adapter.runReadOnlySql(
      `SELECT value FROM items WHERE value LIKE 'ro-%'`, {}, { rowLimit: 1 },
    );
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(true);
  });

  test('a trailing semicolon is tolerated', async () => {
    const result = await adapter.runReadOnlySql(`SELECT 1 AS one;`, {});
    expect(result.rows).toEqual([{ one: 1 }]);
  });

  test('a bare write statement cannot survive the SELECT wrapper', async () => {
    await expect(
      adapter.runReadOnlySql(
        `INSERT INTO items (id, parent_id, type, value) VALUES ('${crypto.randomUUID()}', '${ROOT_ID}', 'text', 'evil')`,
        {},
      ),
    ).rejects.toThrow();
    const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM items WHERE value = 'evil'`);
    expect(Number(rows[0].n)).toBe(0);
  });

  test('a data-modifying CTE cannot survive the SELECT wrapper either', async () => {
    // Postgres only permits data-modifying CTEs at the top level, and the
    // wrapper demotes the expression to a subquery — rejected before the
    // transaction guard is even consulted.
    await expect(
      adapter.runReadOnlySql(
        `WITH w AS (
           INSERT INTO items (id, parent_id, type, value)
           VALUES ('${crypto.randomUUID()}', '${ROOT_ID}', 'text', 'evil-cte')
           RETURNING id
         ) SELECT id FROM w`,
        {},
      ),
    ).rejects.toThrow(/top level/i);
    const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM items WHERE value = 'evil-cte'`);
    expect(Number(rows[0].n)).toBe(0);
  });

  test('a side-effecting function hits the READ ONLY transaction guard', async () => {
    await pool.query('CREATE SEQUENCE IF NOT EXISTS ro_guard_seq');
    await expect(
      adapter.runReadOnlySql(`SELECT nextval('ro_guard_seq') AS n`, {}),
    ).rejects.toThrow(/read-only/i);
  });

  test('rejects a placeholder with no supplied value', async () => {
    await expect(
      adapter.runReadOnlySql(`SELECT * FROM items WHERE type = {{params.missing}}`, {}),
    ).rejects.toThrow(/missing/i);
  });
});
