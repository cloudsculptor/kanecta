const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLI = path.join(__dirname, 'index.js');
const OUTPUT = path.join(__dirname, '..', 'kanecta-datastore-sample', 'kanecta.txt');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function run(...args) {
  execFileSync('node', [CLI, ...args]);
  return fs.readFileSync(OUTPUT, 'utf8');
}

test('no flags: output contains expected root item', () => {
  const out = run();
  const lines = out.trimEnd().split('\n');
  assert.equal(lines[0], 'Base Work Process');
});

test('no flags: child lines are indented with two spaces per level', () => {
  const out = run();
  const lines = out.trimEnd().split('\n');
  const depth1 = lines.find(l => l.startsWith('  ') && !l.startsWith('    '));
  const depth2 = lines.find(l => l.startsWith('    '));
  assert.ok(depth1, 'expected a depth-1 indented line');
  assert.ok(depth2, 'expected a depth-2 indented line');
});

test('no flags: no line contains a UUID', () => {
  const out = run();
  for (const line of out.trimEnd().split('\n')) {
    const firstToken = line.trimStart().split(' ')[0];
    assert.ok(!UUID_RE.test(firstToken), `unexpected UUID on line: ${line}`);
  }
});

test('no flags: output ends with a newline', () => {
  const out = run();
  assert.ok(out.endsWith('\n'));
});

test('--id: root line starts with a UUID', () => {
  const out = run('--id');
  const firstLine = out.split('\n')[0];
  const uuid = firstLine.split(' ')[0];
  assert.ok(UUID_RE.test(uuid), `expected UUID at start of line, got: ${uuid}`);
});

test('--id: root line format is "<uuid> | <value>"', () => {
  const out = run('--id');
  const firstLine = out.split('\n')[0];
  assert.match(firstLine, /^[0-9a-f-]{36} \| \S/);
  assert.equal(firstLine, 'f1a00001-b45e-4c3d-9e7f-000000000001 | Base Work Process');
});

test('--id: child lines preserve indent after the pipe', () => {
  const out = run('--id');
  const lines = out.trimEnd().split('\n');
  const depth1 = lines.find(l => / \|   \S/.test(l) && !/ \|     \S/.test(l));
  const depth2 = lines.find(l => / \|     \S/.test(l));
  assert.ok(depth1, 'expected a depth-1 indented line after pipe');
  assert.ok(depth2, 'expected a depth-2 indented line after pipe');
});

test('--id: every line has a UUID prefix', () => {
  const out = run('--id');
  for (const line of out.trimEnd().split('\n')) {
    const uuid = line.split(' ')[0];
    assert.ok(UUID_RE.test(uuid), `line missing UUID prefix: ${line}`);
  }
});

test('--id: every line contains " | " separator', () => {
  const out = run('--id');
  for (const line of out.trimEnd().split('\n')) {
    assert.ok(line.includes(' | '), `line missing " | " separator: ${line}`);
  }
});

test('--id and no-flag outputs have the same number of lines', () => {
  const plain = run().trimEnd().split('\n');
  const withId = run('--id').trimEnd().split('\n');
  assert.equal(withId.length, plain.length);
});

test('--id: value portion matches plain output for each line', () => {
  const plain = run().trimEnd().split('\n');
  const withId = run('--id').trimEnd().split('\n');
  for (let i = 0; i < plain.length; i++) {
    const valueAfterPipe = withId[i].replace(/^[0-9a-f-]{36} \| /, '');
    assert.equal(valueAfterPipe, plain[i], `line ${i} value mismatch`);
  }
});
