#!/usr/bin/env node
'use strict';

// Ensures the local Keycloak+Postgres+MinIO dev/test stack (see ../docker-compose.yml)
// is up and accepting connections. Safe to call repeatedly — does nothing if the
// containers are already running and healthy.
//
// Usage as a script:   node scripts/ensure-running.js
// Usage as a module:   const { ensureRunning } = require('./scripts/ensure-running');
//                      await ensureRunning();

const path = require('path');
const { execFileSync } = require('child_process');

const COMPOSE_DIR = path.join(__dirname, '..');
const CONTAINER = 'kanecta-keycloak';

const KEYCLOAK_URL = 'http://localhost:45980';
const REALM = 'kanecta-test';
const MINIO_URL = 'http://localhost:45990';

function dockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function containerRunning() {
  try {
    const out = execFileSync(
      'docker', ['compose', 'ps', '--status', 'running', '--format', '{{.Name}}'],
      { cwd: COMPOSE_DIR, encoding: 'utf8' },
    );
    return out.split('\n').includes(CONTAINER);
  } catch {
    return false;
  }
}

function composeUp() {
  execFileSync('docker', ['compose', 'up', '-d'], { cwd: COMPOSE_DIR, stdio: 'inherit' });
}

async function canConnect(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilReady(url, timeoutMs = 90_000, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(url)) return true;
    await sleep(intervalMs);
  }
  return false;
}

// Ensures the stack is up and Keycloak (with the kanecta-test realm imported)
// and MinIO are accepting connections. Throws on failure.
async function ensureRunning({ log = () => {} } = {}) {
  if (!dockerAvailable()) {
    throw new Error(
      'Docker is not available. Install Docker (or Docker Desktop) and ensure the daemon is running, ' +
      `then run "docker compose up -d" in ${COMPOSE_DIR}.`,
    );
  }

  if (containerRunning()) {
    log(`✓ ${CONTAINER} is already running`);
  } else {
    log(`→ starting ${CONTAINER} stack (keycloak, keycloak-db, minio)`);
    composeUp();
  }

  log('→ waiting for Keycloak to import the kanecta-test realm...');
  const realmUrl = `${KEYCLOAK_URL}/realms/${REALM}/.well-known/openid-configuration`;
  if (!(await waitUntilReady(realmUrl))) {
    throw new Error(`Timed out waiting for Keycloak realm '${REALM}'. Check "docker compose logs keycloak" in ${COMPOSE_DIR}.`);
  }
  log(`✓ Keycloak ready at ${KEYCLOAK_URL} (realm: ${REALM})`);

  log('→ waiting for MinIO...');
  if (!(await waitUntilReady(`${MINIO_URL}/minio/health/live`))) {
    throw new Error(`Timed out waiting for MinIO. Check "docker compose logs minio" in ${COMPOSE_DIR}.`);
  }
  log(`✓ MinIO ready at ${MINIO_URL}`);

  return { keycloakUrl: KEYCLOAK_URL, realm: REALM, minioUrl: MINIO_URL };
}

if (require.main === module) {
  ensureRunning({ log: (msg) => console.log(msg) })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n✗ ${err.message}\n`);
      process.exit(1);
    });
}

module.exports = { ensureRunning, KEYCLOAK_URL, REALM, MINIO_URL };
