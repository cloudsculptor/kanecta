#!/usr/bin/env node
'use strict';

// Ensures the local Postgres dev container (see ../docker-compose.yml) is up
// and accepting connections. Safe to call repeatedly — does nothing if the
// container is already running and healthy.
//
// Usage as a script:   node scripts/ensure-running.js
// Usage as a module:   const { ensureRunning } = require('./scripts/ensure-running');
//                      await ensureRunning();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');

const COMPOSE_DIR = path.join(__dirname, '..');
const CONTAINER = 'kanecta-postgres';

// The container persists its data under COMPOSE_DIR/.kanecta/database (see the
// volume mount in docker-compose.yml). Post-1.4.0 this is a fixed local path,
// not derived from a datastore location — a Postgres working set's data lives in
// Postgres, and the datastore location comes from config.json, not an env var.
const DB_DIR = path.join(COMPOSE_DIR, '.kanecta', 'database');

const CONNECTION = {
  host: 'localhost',
  port: 5432,
  user: 'kanecta',
  password: 'kanecta',
  database: 'kanecta',
};

const CONNECTION_STRING = `postgres://${CONNECTION.user}:${CONNECTION.password}@${CONNECTION.host}:${CONNECTION.port}/${CONNECTION.database}`;

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

async function canConnect() {
  const client = new Client(CONNECTION);
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilReady(timeoutMs = 30_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect()) return true;
    await sleep(intervalMs);
  }
  return false;
}

// Ensures the container is up and Postgres is accepting connections.
// Returns connection details on success, throws on failure.
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
    fs.mkdirSync(DB_DIR, { recursive: true });
    log(`→ starting ${CONTAINER} (data dir: ${DB_DIR})`);
    composeUp();
  }

  log('→ waiting for Postgres to accept connections...');
  const ready = await waitUntilReady();
  if (!ready) {
    throw new Error(`Timed out waiting for ${CONTAINER} to accept connections. Check "docker compose logs" in ${COMPOSE_DIR}.`);
  }

  log(`✓ Postgres is ready at ${CONNECTION_STRING}`);
  return { ...CONNECTION, connectionString: CONNECTION_STRING };
}

if (require.main === module) {
  ensureRunning({ log: (msg) => console.log(msg) })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n✗ ${err.message}\n`);
      process.exit(1);
    });
}

module.exports = { ensureRunning, CONNECTION, CONNECTION_STRING };
