/**
 * Coarse read/write gate (src/middleware/write-gate.ts). Two invariants matter
 * most and are asserted first: it is a NO-OP under AUTH_DISABLED (so local/unauth
 * Studio and same-host tokenless backends like a community-hub API are never
 * broken), and reads are always open to an authenticated caller. Writes require a
 * generic write capability; kanecta-api knows no application role names.
 */

import { requireWrite } from '../src/middleware/write-gate.ts';

function invoke(req: { method: string; path: string; user?: { roles?: string[] } }) {
  let nexted = false;
  let status = 200;
  let body: unknown;
  const res: any = {
    status(code: number) { status = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  };
  requireWrite(req as any, res as any, () => { nexted = true; });
  return { nexted, status, body };
}

const SAVED = { AUTH_DISABLED: process.env.AUTH_DISABLED, KANECTA_WRITE_ROLE: process.env.KANECTA_WRITE_ROLE };
beforeEach(() => { delete process.env.AUTH_DISABLED; delete process.env.KANECTA_WRITE_ROLE; });
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('requireWrite — coarse read/write gate', () => {
  it('is a NO-OP under AUTH_DISABLED, even for a mutation with no user (local/unauth + same-host backends)', () => {
    process.env.AUTH_DISABLED = 'true';
    const r = invoke({ method: 'POST', path: '/items', user: undefined });
    expect(r.nexted).toBe(true);
  });

  it('opens all reads to any authenticated caller (no write role needed)', () => {
    expect(invoke({ method: 'GET', path: '/items', user: { roles: [] } }).nexted).toBe(true);
    expect(invoke({ method: 'GET', path: '/items/abc', user: { roles: ['read'] } }).nexted).toBe(true);
  });

  it('exempts the read-only GraphQL POST', () => {
    expect(invoke({ method: 'POST', path: '/graphql', user: { roles: [] } }).nexted).toBe(true);
  });

  it('blocks a mutation for a reader with 403', () => {
    const r = invoke({ method: 'POST', path: '/items', user: { roles: ['read'] } });
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'Write access required' });
  });

  it('allows a mutation for a writer, and for admin (implies write)', () => {
    expect(invoke({ method: 'POST', path: '/items', user: { roles: ['write'] } }).nexted).toBe(true);
    expect(invoke({ method: 'DELETE', path: '/items/x', user: { roles: ['admin'] } }).nexted).toBe(true);
    expect(invoke({ method: 'PUT', path: '/items/x/object', user: { roles: ['viewer', 'write'] } }).nexted).toBe(true);
  });

  it('honours the KANECTA_WRITE_ROLE override', () => {
    process.env.KANECTA_WRITE_ROLE = 'editor';
    expect(invoke({ method: 'PUT', path: '/items/x', user: { roles: ['write'] } }).status).toBe(403);
    expect(invoke({ method: 'PUT', path: '/items/x', user: { roles: ['editor'] } }).nexted).toBe(true);
  });
});
