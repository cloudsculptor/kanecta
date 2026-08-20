import { test } from 'node:test';
import assert from 'node:assert';
import {
  listQueryPlaceholders,
  substituteQueryParams,
  QueryParamError,
} from '../src/index.js';

test('listQueryPlaceholders returns distinct names in source order', () => {
  const expr = 'SELECT * FROM t WHERE a = {{params.status}} AND b = {{ params.owner }} OR a = {{params.status}}';
  assert.deepEqual(listQueryPlaceholders(expr), ['status', 'owner']);
});

test('listQueryPlaceholders is empty for an expression without placeholders', () => {
  assert.deepEqual(listQueryPlaceholders('SELECT 1'), []);
});

test('postgres: placeholders become $n positional bindings, repeats reuse one binding', () => {
  const { sql, values } = substituteQueryParams(
    'SELECT * FROM t WHERE a = {{params.status}} AND (b = {{params.owner}} OR c = {{params.status}})',
    { status: 'open', owner: 'rich' },
    'postgres',
  );
  assert.equal(sql, 'SELECT * FROM t WHERE a = $1 AND (b = $2 OR c = $1)');
  assert.deepEqual(values, ['open', 'rich']);
});

test('sqlite: placeholders become @name bindings with a named value map', () => {
  const { sql, values } = substituteQueryParams(
    'SELECT * FROM t WHERE a = {{params.status}} AND b = {{params.status}}',
    { status: 'open', unused: 'ignored' },
    'sqlite',
  );
  assert.equal(sql, 'SELECT * FROM t WHERE a = @status AND b = @status');
  assert.deepEqual(values, { status: 'open' });
});

test('null is a legal parameter value; undefined is missing', () => {
  const { values } = substituteQueryParams(
    'SELECT * FROM t WHERE a = {{params.x}}',
    { x: null },
    'postgres',
  );
  assert.deepEqual(values, [null]);
  assert.throws(
    () => substituteQueryParams('SELECT {{params.x}}', {}, 'postgres'),
    (err: Error) => err instanceof QueryParamError && /Missing value.*x/.test(err.message),
  );
});

test('an expression without placeholders passes through unchanged', () => {
  const { sql, values } = substituteQueryParams('SELECT 1 AS one', {}, 'sqlite');
  assert.equal(sql, 'SELECT 1 AS one');
  assert.deepEqual(values, {});
});

test('values are never interpolated into the SQL text', () => {
  const hostile = "'; DROP TABLE items; --";
  const { sql } = substituteQueryParams(
    'SELECT * FROM t WHERE a = {{params.x}}',
    { x: hostile },
    'postgres',
  );
  assert.ok(!sql.includes('DROP TABLE'));
  assert.equal(sql, 'SELECT * FROM t WHERE a = $1');
});

test('unknown dialect throws', () => {
  assert.throws(() => substituteQueryParams('SELECT 1', {}, 'oracle' as never), /dialect/i);
});
