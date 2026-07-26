/**
 * GET /auth-config is the PUBLIC boot-time auth configuration a client fetches
 * before login, so one built Studio artifact serves any deployment (spec:
 * kanecta-specification/1.4.0/core-file-specs/auth-config.json). It must be
 * reachable WITHOUT a token (a client can't present one before it knows how to
 * log in) and must expose only non-secret client config.
 */

import request from 'supertest';
import app from '../src/app.ts';

const AUTH_KEYS = ['AUTH_DISABLED', 'KEYCLOAK_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_CLIENT_ID'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of AUTH_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of AUTH_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('GET /auth-config (public)', () => {
  it('reports authDisabled with null config when AUTH_DISABLED', async () => {
    process.env.AUTH_DISABLED = 'true';

    // No Authorization header — the endpoint must not require one.
    const res = await request(app).get('/auth-config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authDisabled: true, keycloakUrl: null, realm: null, clientId: null });
  });

  it('advertises non-secret keycloak config when auth is enabled, without a token', async () => {
    delete process.env.AUTH_DISABLED;
    process.env.KEYCLOAK_URL = 'https://auth.example.com';
    process.env.KEYCLOAK_REALM = 'acme-studio';
    process.env.KEYCLOAK_CLIENT_ID = 'studio-web';

    // Still no token: a 200 here proves the route bypasses requireAuth.
    const res = await request(app).get('/auth-config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authDisabled: false,
      keycloakUrl: 'https://auth.example.com',
      realm: 'acme-studio',
      clientId: 'studio-web',
    });
  });
});
