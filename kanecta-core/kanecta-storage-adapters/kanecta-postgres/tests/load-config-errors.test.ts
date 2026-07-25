// _loadConfig error discrimination — no live Postgres needed (fake pool).
//
// open() reports "Not a Kanecta database: config missing or empty" ONLY when
// the config genuinely isn't there (missing relation → fallback → null).
// Connection-class failures (auth, DNS, TLS, timeout) must rethrow as
// themselves: swallowing them behind the not-a-kanecta-database message cost a
// nonprod debugging round-trip (2026-07 pre-prod queue item).

import { describe, it, expect } from 'vitest';
import { PostgresAdapter } from '../src/adapter.ts';

function pgError(code: string, message: string) {
  const err: any = new Error(message);
  err.code = code;
  return err;
}

function poolRejectingWith(err: any) {
  return { query: () => Promise.reject(err) } as any;
}

describe('_loadConfig error handling', () => {
  it('missing relations (42P01) on both reads → open() reports not-a-kanecta-database', async () => {
    const pool = poolRejectingWith(pgError('42P01', 'relation "obj_..." does not exist'));
    await expect(PostgresAdapter.open(pool)).rejects.toThrow(
      /Not a Kanecta database: config missing or empty/,
    );
  });

  it('missing schema (3F000) is treated like a missing relation', async () => {
    const pool = poolRejectingWith(pgError('3F000', 'schema "nope" does not exist'));
    await expect(PostgresAdapter.open(pool)).rejects.toThrow(
      /Not a Kanecta database: config missing or empty/,
    );
  });

  it('auth failure (28P01) rethrows as itself, not as not-a-kanecta-database', async () => {
    const pool = poolRejectingWith(pgError('28P01', 'password authentication failed for user "svc"'));
    await expect(PostgresAdapter.open(pool)).rejects.toThrow(/password authentication failed/);
  });

  it('network failure (ECONNREFUSED) rethrows as itself', async () => {
    const pool = poolRejectingWith(pgError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:25060'));
    await expect(PostgresAdapter.open(pool)).rejects.toThrow(/ECONNREFUSED/);
  });

  it('a codeless error (e.g. TLS) rethrows as itself', async () => {
    const pool = poolRejectingWith(new Error('self-signed certificate in certificate chain'));
    await expect(PostgresAdapter.open(pool)).rejects.toThrow(/self-signed certificate/);
  });
});
