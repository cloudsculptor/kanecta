// Integration tests for the requireAuth/requireRole middleware, run against a
// *real* Keycloak instance (not mocked JWTs) — see kanecta-keycloak/.
//
// Prerequisite:  npm run docker:up -w kanecta-keycloak
//
// If that stack isn't reachable, these tests are skipped with a clear message
// (mirrors kanecta-postgres/tests/adapter.test.js, which assumes a running
// local Postgres — except here we degrade gracefully since most contributors
// won't have Keycloak running locally).

import { vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import express from 'express';
import request from 'supertest';
import { Datastore } from '@kanecta/lib';
import { requireAuth, requireRole } from '../src/middleware/auth.ts';
import { useConfig, clearConfigEnv } from './helpers.ts';

const KEYCLOAK_URL = process.env.KANECTA_TEST_KEYCLOAK_URL || 'http://localhost:45980';
const REALM = process.env.KANECTA_TEST_KEYCLOAK_REALM || 'kanecta-test';
const CLIENT_ID = process.env.KANECTA_TEST_KEYCLOAK_CLIENT_ID || 'kanecta-studio-test';
const ISSUER = `${KEYCLOAK_URL}/realms/${REALM}`;
const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;

const ADMIN_USER = { username: 'kanecta-admin', password: 'kanecta-admin-password' };
const MEMBER_USER = { username: 'kanecta-member', password: 'kanecta-member-password' };

function keycloakReachable() {
  try {
    execFileSync('curl', ['-sf', '-o', '/dev/null', `${ISSUER}/.well-known/openid-configuration`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = keycloakReachable() ? describe : describe.skip;
if (!keycloakReachable()) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n  Skipping kanecta-api/tests/auth.test.js — Keycloak not reachable at ${ISSUER}.\n` +
    `  Run "npm run docker:up -w kanecta-keycloak" to start the test stack.\n`,
  );
}

async function fetchToken({ username, password }) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: CLIENT_ID,
    username,
    password,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Failed to fetch token for ${username}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

describeOrSkip('requireAuth / requireRole (real Keycloak)', () => {
  let tmpRoot;
  let app;
  let adminToken;
  let memberToken;

  beforeAll(async () => {
    process.env.KEYCLOAK_URL = KEYCLOAK_URL;
    process.env.KEYCLOAK_REALM = REALM;
    delete process.env.AUTH_DISABLED;

    // app.ts caches the jwks client at module scope keyed by issuer, and reads
    // env vars at require-time-adjacent points — re-import fresh so it picks
    // up the env vars set above.
    vi.resetModules();
    app = (await import('../src/app.ts')).default;

    [adminToken, memberToken] = await Promise.all([fetchToken(ADMIN_USER), fetchToken(MEMBER_USER)]);
  }, 60_000);

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-auth-test-'));
    Datastore.init(tmpRoot, 'test@example.com');
    useConfig(tmpRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    clearConfigEnv();
  });

  afterAll(() => {
    delete process.env.KEYCLOAK_URL;
    delete process.env.KEYCLOAK_REALM;
  });

  test('rejects requests with no Authorization header', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing token/);
  });

  test('rejects malformed Authorization headers', async () => {
    const res = await request(app).get('/items').set('Authorization', 'NotBearer abc');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing token/);
  });

  test('rejects invalid/garbage tokens', async () => {
    const res = await request(app).get('/items').set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid token/);
  });

  test('accepts a valid token and populates req.user from the JWT claims', async () => {
    const res = await request(app).get('/items').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('KEYCLOAK_AUDIENCE rejects a token whose aud does not match (401)', async () => {
    process.env.KEYCLOAK_AUDIENCE = 'some-other-client';
    try {
      const app2 = express();
      app2.get('/whoami', requireAuth, (req, res) => res.json(req.user));
      const res = await request(app2).get('/whoami').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(401);
    } finally {
      delete process.env.KEYCLOAK_AUDIENCE;
    }
  });

  // NOTE: the positive KEYCLOAK_AUDIENCE case (token carrying the configured
  // aud is accepted) needs an audience protocol mapper on the client — the
  // kanecta-test realm export doesn't define one, and its access tokens carry
  // NO aud claim at all. Production realms must add the mapper (see the
  // deployment runbook); until the dev realm export gains one, only the
  // enforcement path is integration-tested here.

  test('decodes roles, name and email_verified for the admin user', async () => {
    const app2 = express();
    app2.get('/whoami', requireAuth, (req, res) => res.json(req.user));

    const res = await request(app2).get('/whoami').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.name).toBe('Kanecta Admin');
    expect(res.body.roles).toEqual(expect.arrayContaining(['admin']));
    expect(res.body.email_verified).toBe(true);
  });

  test('decodes roles for the member user', async () => {
    const app2 = express();
    app2.get('/whoami', requireAuth, (req, res) => res.json(req.user));

    const res = await request(app2).get('/whoami').set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(expect.arrayContaining(['member']));
    expect(res.body.roles).not.toEqual(expect.arrayContaining(['admin']));
  });

  describe('requireRole', () => {
    let roleApp;

    beforeAll(() => {
      roleApp = express();
      roleApp.get('/admin-only', requireAuth, requireRole('admin'), (req, res) => res.json({ ok: true }));
    });

    test('allows users with the required role', async () => {
      const res = await request(roleApp).get('/admin-only').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    test('rejects users without the required role with 403', async () => {
      const res = await request(roleApp).get('/admin-only').set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Insufficient role/);
    });
  });
});

describe('requireAuth (AUTH_DISABLED bypass)', () => {
  let app;

  beforeAll(async () => {
    process.env.AUTH_DISABLED = 'true';
    vi.resetModules();
    app = (await import('../src/app.ts')).default;
  });

  afterAll(() => {
    delete process.env.AUTH_DISABLED;
    vi.resetModules();
  });

  test('populates a local-dev req.user without a token', async () => {
    const app2 = express();
    app2.get('/whoami', requireAuth, (req, res) => res.json(req.user));

    const res = await request(app2).get('/whoami');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'local-dev', name: 'Local Dev', roles: ['admin'], email_verified: true });
  });
});
