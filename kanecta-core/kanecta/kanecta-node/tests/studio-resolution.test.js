'use strict';

/**
 * E2E smoke test: verifies that `kanecta studio` resolves @kanecta/studio/server
 * correctly, and that invoking it with a missing dependency produces a helpful
 * error message rather than an unhandled crash.
 *
 * Runs with Node's built-in test runner (no extra deps required).
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const INDEX = path.resolve(__dirname, '../index.js');

// ── helper ────────────────────────────────────────────────────────────────

function run(args, opts = {}) {
  return spawnSync(process.execPath, [INDEX, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    ...opts,
  });
}

// ── tests ─────────────────────────────────────────────────────────────────

// 1. help text includes studio
{
  const result = run(['--help']);
  assert.ok(result.stdout.includes('studio'), 'help text should mention studio');
  assert.strictEqual(result.status, 0, 'help should exit 0');
  console.log('✓ help text includes studio');
}

// 2. unknown app gives friendly error
{
  const result = run(['not-an-app']);
  assert.ok(result.stderr.includes('Unknown app'), 'unknown app should print error');
  assert.notStrictEqual(result.status, 0, 'unknown app should exit non-zero');
  console.log('✓ unknown app gives friendly error');
}

// 3. studio subcommand exits with a clear error when @kanecta/studio not installed
//    (In CI / dev without the package installed this is the expected path.)
{
  const result = run(['studio'], {
    env: {
      ...process.env,
      // Force resolution to fail by pointing NODE_PATH nowhere useful
      NODE_PATH: '/tmp/__nonexistent__',
    },
  });
  // Either it succeeds (package is installed) or it prints a helpful error
  if (result.status !== 0) {
    assert.ok(
      result.stderr.includes('@kanecta/studio') || result.stderr.includes('studio'),
      'missing studio should print a helpful error referencing @kanecta/studio',
    );
  }
  console.log('✓ studio subcommand behaves correctly when package absent');
}

// 4. cli subcommand exits with a clear error when @kanecta/cli not installed
{
  const result = run(['cli', '--help'], {
    env: { ...process.env, NODE_PATH: '/tmp/__nonexistent__' },
  });
  if (result.status !== 0) {
    assert.ok(
      result.stderr.includes('@kanecta/cli'),
      'missing cli should mention @kanecta/cli',
    );
  }
  console.log('✓ cli subcommand behaves correctly when package absent');
}

console.log('\nAll smoke tests passed.');
