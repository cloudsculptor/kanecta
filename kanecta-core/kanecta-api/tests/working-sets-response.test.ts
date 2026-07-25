/**
 * GET /working-sets returns a credential-free wire shape (spec:
 * kanecta-specification/1.4.0/core-file-specs/working-sets.json). The on-disk
 * config holds real pg passwords / s3 secrets / embedding api keys; the response
 * must carry NONE of them — not by redacting the config, but because the response
 * is built by hand from a closed { type, label } remote summary that has no field
 * a secret could live in.
 *
 * The second test is the tripwire: if anyone ever reverts to spreading the raw
 * config into the response, a secret value reappears in the payload and it fails.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import app from '../src/app.ts';
import { clearConfigEnv } from './helpers.ts';

let cfgDir;

beforeEach(() => {
  cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-ws-response-test-'));
  fs.writeFileSync(
    path.join(cfgDir, 'config.json'),
    JSON.stringify({
      specVersion: '1.4.0',
      defaultWorkingSet: 'cloudy',
      workingSets: {
        cloudy: {
          remotes: {
            origin: {
              type: 'cloud',
              postgres: {
                host: 'db.example.com', port: 25060, database: 'appdb',
                user: 'svc_user', password: 'super-secret-pg', schema: 'app',
              },
              s3: {
                endpoint: 'https://s3.example.com', region: 'syd1', bucket: 'files',
                accessKeyId: 'AKIA123', secretAccessKey: 'super-secret-s3',
              },
              embeddings: { provider: 'openai-compatible', apiKey: 'sk-super-secret' },
            },
          },
        },
      },
    }),
  );
  process.env.KANECTA_CONFIG = cfgDir;
  process.env.AUTH_DISABLED = 'true';
});

afterEach(() => {
  fs.rmSync(cfgDir, { recursive: true, force: true });
  clearConfigEnv();
  delete process.env.AUTH_DISABLED;
});

describe('GET /working-sets response shape', () => {
  it('exposes only a non-secret { type, label } remote summary', async () => {
    const res = await request(app).get('/working-sets');
    expect(res.status).toBe(200);

    const ws = res.body.workingSets.find((w) => w.name === 'cloudy');
    const origin = ws.remotes.origin;

    // A closed summary — exactly `type` and `label`, nothing else.
    expect(Object.keys(origin).sort()).toEqual(['label', 'type']);
    expect(origin.type).toBe('cloud');
    // Label is built server-side from non-secret fields (host/database).
    expect(origin.label).toBe('db.example.com/appdb');

    // The whole connection block is gone — not even the non-secret sub-objects leak.
    expect(origin.postgres).toBeUndefined();
    expect(origin.s3).toBeUndefined();
    expect(origin.embeddings).toBeUndefined();
  });

  it('carries no secret value anywhere in the payload (tripwire)', async () => {
    const res = await request(app).get('/working-sets');
    const raw = JSON.stringify(res.body);

    // Secrets — must never appear.
    expect(raw).not.toContain('super-secret-pg');
    expect(raw).not.toContain('super-secret-s3');
    expect(raw).not.toContain('sk-super-secret');
    // Connection facts we deliberately no longer send either.
    expect(raw).not.toContain('svc_user');
    expect(raw).not.toContain('AKIA123');
  });
});
