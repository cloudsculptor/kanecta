'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  generateFunctionScaffold,
  getRuntimeDir,
  computeBundleHash,
  toCamelCase,
  toPythonName,
  VALID_RUNTIME_RE,
} = require('../src/generateFunctionCode');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-fn-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── VALID_RUNTIME_RE ─────────────────────────────────────────────────────────

describe('VALID_RUNTIME_RE', () => {
  test.each([
    ['typescript', true],
    ['python', true],
    ['python3', true],
    ['my-runtime', true],
    ['a', true],
    ['ts-node', true],
    ['runtime-v2', true],
  ])('accepts "%s"', (rt, expected) => {
    expect(VALID_RUNTIME_RE.test(rt)).toBe(expected);
  });

  test.each([
    ['TypeScript', false],
    ['PYTHON', false],
    ['-python', false],
    ['python-', false],
    ['my runtime', false],
    ['', false],
    ['my_runtime', false],
  ])('rejects "%s"', (rt, expected) => {
    expect(VALID_RUNTIME_RE.test(rt)).toBe(expected);
  });
});

// ─── toCamelCase ──────────────────────────────────────────────────────────────

describe('toCamelCase', () => {
  test('converts kebab-case', () => expect(toCamelCase('my-function')).toBe('myFunction'));
  test('converts snake_case', () => expect(toCamelCase('my_function')).toBe('myFunction'));
  test('lower-cases first char', () => expect(toCamelCase('MyFunction')).toBe('myFunction'));
  test('handles spaces', () => expect(toCamelCase('my function')).toBe('myFunction'));
  test('empty fallback', () => expect(toCamelCase('')).toBe('fn'));
  test('passes through simple', () => expect(toCamelCase('foo')).toBe('foo'));
});

// ─── toPythonName ─────────────────────────────────────────────────────────────

describe('toPythonName', () => {
  test('converts to valid Python identifier', () => {
    expect(toPythonName('my-function')).toBe('myFunction');
  });
  test('replaces hyphens with underscores after camel', () => {
    expect(toPythonName('hello world')).toBe('helloWorld');
  });
  test('does not start with digit', () => {
    const result = toPythonName('123abc');
    expect(/^[^0-9]/.test(result)).toBe(true);
  });
});

// ─── getRuntimeDir ────────────────────────────────────────────────────────────

describe('getRuntimeDir', () => {
  test('returns .function/<runtime> under itemDir', () => {
    expect(getRuntimeDir('/data/item/uuid', 'typescript'))
      .toBe('/data/item/uuid/.function/typescript');
  });
  test('defaults to typescript', () => {
    expect(getRuntimeDir('/data/item/uuid', undefined))
      .toBe('/data/item/uuid/.function/typescript');
  });
  test('python path', () => {
    expect(getRuntimeDir('/data/item/uuid', 'python'))
      .toBe('/data/item/uuid/.function/python');
  });
});

// ─── generateFunctionScaffold — TypeScript ────────────────────────────────────

describe('generateFunctionScaffold — typescript', () => {
  let itemDir;
  beforeEach(() => { itemDir = tmpDir(); });
  afterEach(() => cleanup(itemDir));

  function scaffold(fnData) {
    return generateFunctionScaffold(itemDir, 'myFunction', fnData, itemDir);
  }

  test('creates .function/typescript/ directory', () => {
    scaffold({});
    expect(fs.existsSync(path.join(itemDir, '.function', 'typescript'))).toBe(true);
  });

  test('returns the runtimeDir path', () => {
    const rd = scaffold({});
    expect(rd).toBe(path.join(itemDir, '.function', 'typescript'));
  });

  test('creates package.json', () => {
    scaffold({ includeKanectaSdk: false });
    const pkg = JSON.parse(fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'package.json'), 'utf8'));
    expect(pkg.name).toBe('kanecta-fn-my-function');
    expect(pkg.scripts.build).toBe('tsc');
  });

  test('creates tsconfig.json', () => {
    scaffold({});
    const tsconfig = JSON.parse(fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'tsconfig.json'), 'utf8'));
    expect(tsconfig.compilerOptions.outDir).toBe('dist');
  });

  test('tsconfig.json not overwritten on re-scaffold', () => {
    scaffold({});
    const tsconfigPath = path.join(itemDir, '.function', 'typescript', 'tsconfig.json');
    fs.writeFileSync(tsconfigPath, '{"custom":true}', 'utf8');
    scaffold({});
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    expect(tsconfig.custom).toBe(true);
  });

  test('creates index.ts with function stub', () => {
    scaffold({ parameters: [], returnType: 'void' });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('export function myFunction');
    expect(ts).toContain('// TODO: implement');
    expect(ts).toContain('AUTO-GENERATED');
  });

  test('index.ts always regenerated', () => {
    scaffold({ returnType: 'void' });
    const tsPath = path.join(itemDir, '.function', 'typescript', 'index.ts');
    fs.writeFileSync(tsPath, '// custom content', 'utf8');
    scaffold({ returnType: 'string' });
    const ts = fs.readFileSync(tsPath, 'utf8');
    expect(ts).toContain('): string');
  });

  test('generates async function', () => {
    scaffold({ async: true, returnType: 'Promise<void>' });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('export async function myFunction');
  });

  test('generates parameters with types', () => {
    scaffold({
      parameters: [
        { name: 'name', type: 'string' },
        { name: 'count', type: 'number' },
      ],
      returnType: 'void',
    });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('name: string');
    expect(ts).toContain('count: number');
  });

  test('generates optional parameter', () => {
    scaffold({ parameters: [{ name: 'label', type: 'string', optional: true }] });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('label?: string');
  });

  test('generates parameter with default value', () => {
    scaffold({ parameters: [{ name: 'mode', type: 'string', defaultValue: 'auto' }] });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('mode: string = "auto"');
  });

  test('generates rest parameter', () => {
    scaffold({ parameters: [{ name: 'items', type: 'string[]', rest: true }] });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('...items: string[]');
  });

  test('generates generic type parameters', () => {
    scaffold({
      typeParameters: [{ name: 'T', constraint: 'object' }],
      parameters: [{ name: 'input', type: 'T' }],
      returnType: 'T',
    });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('<T extends object>');
  });

  test('includes JSDoc from description', () => {
    scaffold({ description: 'Does a thing', returnType: 'void' });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('* Does a thing');
  });

  test('includes JSDoc @throws', () => {
    scaffold({ throws: [{ type: 'Error', description: 'on failure' }] });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('@throws {Error} - on failure');
  });

  test('includes JSDoc @deprecated', () => {
    scaffold({ deprecated: 'use newFn instead' });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('@deprecated use newFn instead');
  });

  test('includes body when provided', () => {
    scaffold({ body: 'return 42;', returnType: 'number' });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain('return 42;');
    expect(ts).not.toContain('// TODO: implement');
  });

  test('includes Kanecta SDK imports by default', () => {
    scaffold({});
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).toContain("import { Datastore");
    expect(ts).toContain("resolveWorkingSet()");
  });

  test('omits Kanecta SDK when includeKanectaSdk=false', () => {
    scaffold({ includeKanectaSdk: false });
    const ts = fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'index.ts'), 'utf8');
    expect(ts).not.toContain("import { Datastore }");
  });

  test('package.json includes extra dependencies', () => {
    scaffold({ includeKanectaSdk: false, dependencies: ['lodash@4.17.21', 'axios'] });
    const pkg = JSON.parse(fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'package.json'), 'utf8'));
    expect(pkg.dependencies.lodash).toBe('4.17.21');
    expect(pkg.dependencies.axios).toBe('*');
  });

  test('package.json always regenerated (deps stay in sync)', () => {
    scaffold({ includeKanectaSdk: false, dependencies: ['lodash'] });
    scaffold({ includeKanectaSdk: false, dependencies: ['axios'] });
    const pkg = JSON.parse(fs.readFileSync(path.join(itemDir, '.function', 'typescript', 'package.json'), 'utf8'));
    expect(pkg.dependencies.axios).toBe('*');
    expect(pkg.dependencies.lodash).toBeUndefined();
  });

  test('uses runtime from fnData.runtime', () => {
    generateFunctionScaffold(itemDir, 'myFn', { runtime: 'typescript' }, itemDir);
    expect(fs.existsSync(path.join(itemDir, '.function', 'typescript'))).toBe(true);
  });

  test('defaults to typescript when runtime absent', () => {
    generateFunctionScaffold(itemDir, 'myFn', {}, itemDir);
    expect(fs.existsSync(path.join(itemDir, '.function', 'typescript'))).toBe(true);
  });

  test('throws for invalid runtime name', () => {
    expect(() => generateFunctionScaffold(itemDir, 'myFn', { runtime: 'TypeScript' }, itemDir))
      .toThrow(/Invalid runtime name/);
  });
});

// ─── generateFunctionScaffold — Python ───────────────────────────────────────

describe('generateFunctionScaffold — python', () => {
  let itemDir;
  beforeEach(() => { itemDir = tmpDir(); });
  afterEach(() => cleanup(itemDir));

  function scaffold(fnData = {}) {
    return generateFunctionScaffold(itemDir, 'myFunction', { runtime: 'python', ...fnData }, itemDir);
  }

  test('creates .function/python/ directory', () => {
    scaffold();
    expect(fs.existsSync(path.join(itemDir, '.function', 'python'))).toBe(true);
  });

  test('returns the runtimeDir path', () => {
    const rd = scaffold();
    expect(rd).toBe(path.join(itemDir, '.function', 'python'));
  });

  test('creates main.py', () => {
    scaffold();
    expect(fs.existsSync(path.join(itemDir, '.function', 'python', 'main.py'))).toBe(true);
  });

  test('creates requirements.txt', () => {
    scaffold();
    expect(fs.existsSync(path.join(itemDir, '.function', 'python', 'requirements.txt'))).toBe(true);
  });

  test('main.py has AUTO-GENERATED header', () => {
    scaffold();
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain('AUTO-GENERATED');
    expect(py).toContain('from __future__ import annotations');
  });

  test('main.py has function stub', () => {
    scaffold();
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain('def myFunction(');
    expect(py).toContain('...');
  });

  test('maps TypeScript types to Python annotations', () => {
    scaffold({
      parameters: [
        { name: 'name', type: 'string' },
        { name: 'count', type: 'number' },
        { name: 'flag', type: 'boolean' },
      ],
      returnType: 'string',
    });
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain('name: str');
    expect(py).toContain('count: float');
    expect(py).toContain('flag: bool');
    expect(py).toContain('-> str');
  });

  test('optional parameter becomes = None', () => {
    scaffold({ parameters: [{ name: 'label', type: 'string', optional: true }] });
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain('label: str = None');
  });

  test('parameter with default value', () => {
    scaffold({ parameters: [{ name: 'count', type: 'number', defaultValue: '10' }] });
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain('count: float = 10');
  });

  test('includes description as docstring', () => {
    scaffold({ description: 'Processes data' });
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain('"""Processes data"""');
  });

  test('includes param descriptions as :param:', () => {
    scaffold({ parameters: [{ name: 'x', type: 'number', description: 'the input' }] });
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain(':param x: the input');
  });

  test('marks deprecated functions', () => {
    scaffold({ deprecated: 'use newFn' });
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain('@deprecated: use newFn');
  });

  test('includes body when provided', () => {
    scaffold({ body: 'return 42', returnType: 'number' });
    const py = fs.readFileSync(path.join(itemDir, '.function', 'python', 'main.py'), 'utf8');
    expect(py).toContain('return 42');
    expect(py).not.toContain('...');
  });

  test('requirements.txt is empty when no deps', () => {
    scaffold({ includeKanectaSdk: false, dependencies: [] });
    const reqs = fs.readFileSync(path.join(itemDir, '.function', 'python', 'requirements.txt'), 'utf8');
    expect(reqs.trim()).toBe('');
  });

  test('requirements.txt includes extra deps', () => {
    scaffold({ includeKanectaSdk: false, dependencies: ['requests', 'pandas>=2.0'] });
    const reqs = fs.readFileSync(path.join(itemDir, '.function', 'python', 'requirements.txt'), 'utf8');
    expect(reqs).toContain('requests');
    expect(reqs).toContain('pandas>=2.0');
  });

  test('requirements.txt SDK comment included by default', () => {
    scaffold({});
    const reqs = fs.readFileSync(path.join(itemDir, '.function', 'python', 'requirements.txt'), 'utf8');
    expect(reqs).toContain('# kanecta-sdk');
  });

  test('main.py always regenerated', () => {
    scaffold({ returnType: 'string' });
    const pyPath = path.join(itemDir, '.function', 'python', 'main.py');
    fs.writeFileSync(pyPath, '# custom', 'utf8');
    scaffold({ returnType: 'number' });
    const py = fs.readFileSync(pyPath, 'utf8');
    expect(py).toContain('-> float');
  });
});

// ─── Multiple files per function ──────────────────────────────────────────────

describe('multiple files per function', () => {
  let itemDir;
  beforeEach(() => { itemDir = tmpDir(); });
  afterEach(() => cleanup(itemDir));

  test('user files in runtime dir survive re-scaffold', () => {
    generateFunctionScaffold(itemDir, 'fn', {}, itemDir);
    const runtimeDir = path.join(itemDir, '.function', 'typescript');
    fs.writeFileSync(path.join(runtimeDir, 'utils.ts'), '// my utility', 'utf8');
    generateFunctionScaffold(itemDir, 'fn', {}, itemDir);
    expect(fs.readFileSync(path.join(runtimeDir, 'utils.ts'), 'utf8')).toBe('// my utility');
  });

  test('user subdirectories survive re-scaffold', () => {
    generateFunctionScaffold(itemDir, 'fn', {}, itemDir);
    const runtimeDir = path.join(itemDir, '.function', 'typescript');
    fs.mkdirSync(path.join(runtimeDir, 'lib'));
    fs.writeFileSync(path.join(runtimeDir, 'lib', 'helper.ts'), '// helper', 'utf8');
    generateFunctionScaffold(itemDir, 'fn', {}, itemDir);
    expect(fs.existsSync(path.join(runtimeDir, 'lib', 'helper.ts'))).toBe(true);
  });

  test('multiple runtimes can coexist for the same item', () => {
    generateFunctionScaffold(itemDir, 'fn', { runtime: 'typescript' }, itemDir);
    generateFunctionScaffold(itemDir, 'fn', { runtime: 'python' }, itemDir);
    expect(fs.existsSync(path.join(itemDir, '.function', 'typescript', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(itemDir, '.function', 'python', 'main.py'))).toBe(true);
  });
});

// ─── computeBundleHash ────────────────────────────────────────────────────────

describe('computeBundleHash', () => {
  let dir;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => cleanup(dir));

  test('returns sha256: prefixed hash', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function foo() {}', 'utf8');
    const hash = computeBundleHash(dir);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('same content → same hash', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function foo() {}', 'utf8');
    const a = computeBundleHash(dir);
    const b = computeBundleHash(dir);
    expect(a).toBe(b);
  });

  test('different content → different hash', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function foo() {}', 'utf8');
    const a = computeBundleHash(dir);
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function bar() {}', 'utf8');
    const b = computeBundleHash(dir);
    expect(a).not.toBe(b);
  });

  test('adding a file changes the hash', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export function foo() {}', 'utf8');
    const a = computeBundleHash(dir);
    fs.writeFileSync(path.join(dir, 'utils.ts'), 'export function bar() {}', 'utf8');
    const b = computeBundleHash(dir);
    expect(a).not.toBe(b);
  });

  test('node_modules/ excluded from hash', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'content', 'utf8');
    const a = computeBundleHash(dir);
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'huge dep', 'utf8');
    const b = computeBundleHash(dir);
    expect(a).toBe(b);
  });

  test('dist/ excluded from hash', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'content', 'utf8');
    const a = computeBundleHash(dir);
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'compiled output', 'utf8');
    const b = computeBundleHash(dir);
    expect(a).toBe(b);
  });

  test('__pycache__/ excluded from hash', () => {
    fs.writeFileSync(path.join(dir, 'main.py'), 'def foo(): ...', 'utf8');
    const a = computeBundleHash(dir);
    fs.mkdirSync(path.join(dir, '__pycache__'));
    fs.writeFileSync(path.join(dir, '__pycache__', 'main.cpython-311.pyc'), 'bytecode', 'utf8');
    const b = computeBundleHash(dir);
    expect(a).toBe(b);
  });

  test('.build-hash file excluded from hash', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'content', 'utf8');
    const a = computeBundleHash(dir);
    fs.writeFileSync(path.join(dir, '.build-hash'), a + '\n', 'utf8');
    const b = computeBundleHash(dir);
    expect(a).toBe(b);
  });

  test('hash is stable across file ordering in directory', () => {
    fs.writeFileSync(path.join(dir, 'b.ts'), 'B', 'utf8');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'A', 'utf8');
    const hash = computeBundleHash(dir);
    expect(hash).toMatch(/^sha256:/);
  });

  test('subdirectory contents included in hash', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'content', 'utf8');
    const a = computeBundleHash(dir);
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'lib', 'helper.ts'), 'helper', 'utf8');
    const b = computeBundleHash(dir);
    expect(a).not.toBe(b);
  });

  test('empty directory produces stable hash', () => {
    const a = computeBundleHash(dir);
    const b = computeBundleHash(dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:/);
  });
});

// ─── computeBundleHash — integration with scaffold ───────────────────────────

describe('computeBundleHash — scaffold integration', () => {
  let itemDir;
  beforeEach(() => { itemDir = tmpDir(); });
  afterEach(() => cleanup(itemDir));

  test('hash changes when index.ts is regenerated with new signature', () => {
    generateFunctionScaffold(itemDir, 'fn', { runtime: 'typescript', returnType: 'void' }, itemDir);
    const runtimeDir = getRuntimeDir(itemDir, 'typescript');
    const h1 = computeBundleHash(runtimeDir);
    generateFunctionScaffold(itemDir, 'fn', { runtime: 'typescript', returnType: 'string' }, itemDir);
    const h2 = computeBundleHash(runtimeDir);
    expect(h1).not.toBe(h2);
  });

  test('hash stable when scaffold regenerated with identical data', () => {
    const fnData = { runtime: 'typescript', returnType: 'void', includeKanectaSdk: false };
    generateFunctionScaffold(itemDir, 'fn', fnData, itemDir);
    const runtimeDir = getRuntimeDir(itemDir, 'typescript');
    const h1 = computeBundleHash(runtimeDir);
    generateFunctionScaffold(itemDir, 'fn', fnData, itemDir);
    const h2 = computeBundleHash(runtimeDir);
    expect(h1).toBe(h2);
  });

  test('Python hash changes when main.py is regenerated with new params', () => {
    generateFunctionScaffold(itemDir, 'fn', { runtime: 'python' }, itemDir);
    const runtimeDir = getRuntimeDir(itemDir, 'python');
    const h1 = computeBundleHash(runtimeDir);
    generateFunctionScaffold(itemDir, 'fn', {
      runtime: 'python',
      parameters: [{ name: 'x', type: 'number' }],
    }, itemDir);
    const h2 = computeBundleHash(runtimeDir);
    expect(h1).not.toBe(h2);
  });
});
