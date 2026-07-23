/**
 * GET /working-sets must never echo credential values. The config on disk holds
 * real pg passwords / s3 secrets / embedding api keys — the endpoint's job is
 * inventory (what remotes exist, are they configured), so every secret-bearing
 * value is replaced with '***' while the keys stay present.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import app from '../src/app.ts';
import { clearConfigEnv } from './helpers.ts';

let cfgDir;

beforeEach(() => {
  cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-redact-test-'));
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

describe('GET /working-sets secret redaction', () => {
  it('replaces every credential value with *** and keeps the rest', async () => {
    const res = await request(app).get('/working-sets');
    expect(res.status).toBe(200);

    const ws = res.body.workingSets.find((w) => w.name === 'cloudy');
    const origin = ws.remotes.origin;

    // Secrets are placeholders — never the configured values.
    expect(origin.postgres.password).toBe('***');
    expect(origin.s3.secretAccessKey).toBe('***');
    expect(origin.embeddings.apiKey).toBe('***');

    // Non-secret connection facts survive for the Studio inventory view.
    expect(origin.postgres.host).toBe('db.example.com');
    expect(origin.postgres.user).toBe('svc_user');
    expect(origin.s3.bucket).toBe('files');

    // Belt and braces: no secret value appears ANYWHERE in the payload.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('super-secret-pg');
    expect(raw).not.toContain('super-secret-s3');
    expect(raw).not.toContain('sk-super-secret');
  });
});
