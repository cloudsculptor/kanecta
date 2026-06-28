'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_RUNTIME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const HASH_EXCLUDE_DIRS = new Set(['node_modules', 'dist', '__pycache__', '.mypy_cache', '.pytest_cache', '.venv', 'venv']);
const HASH_EXCLUDE_FILES = new Set(['.build-hash']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'function';
}

function toCamelCase(name) {
  return name
    .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase())
    .replace(/[^a-zA-Z0-9_$]/g, '_') || 'fn';
}

function toPythonName(name) {
  return toCamelCase(name)
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1');
}

function writeIfAbsent(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

// ─── Runtime directory ────────────────────────────────────────────────────────

// Returns the per-runtime scaffold directory for a function item.
// Structure: <itemDir>/.function/<runtime>/
function getRuntimeDir(itemDir, runtime) {
  return path.join(itemDir, '.function', runtime ?? 'typescript');
}

// ─── Bundle hash ─────────────────────────────────────────────────────────────
//
// SHA-256 over all source files in runtimeDir, sorted deterministically.
// Excludes: node_modules/, dist/, __pycache__/, .mypy_cache/, .pytest_cache/,
//           .venv/, venv/, .build-hash
// Returns "sha256:<hex>".

function computeBundleHash(runtimeDir) {
  const hash = crypto.createHash('sha256');
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isDirectory() && HASH_EXCLUDE_DIRS.has(e.name)) continue;
      if (!e.isDirectory() && HASH_EXCLUDE_FILES.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else {
        hash.update(path.relative(runtimeDir, full) + '\0');
        hash.update(fs.readFileSync(full));
        hash.update('\0');
      }
    }
  }
  walk(runtimeDir);
  return 'sha256:' + hash.digest('hex');
}

// ─── JSON Schema → TypeScript ─────────────────────────────────────────────────

function schemaPropToTs(prop) {
  if (!prop) return 'unknown';
  const t = prop.type;
  if (t === 'string') return 'string';
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'null') return 'null';
  if (t === 'array') {
    const inner = schemaPropToTs(prop.items);
    return `${inner}[]`;
  }
  if (t === 'object') return 'Record<string, unknown>';
  if (Array.isArray(t)) return t.map((x) => schemaPropToTs({ type: x })).join(' | ');
  return 'unknown';
}

function generateInterface(name, jsonSchema) {
  const props = jsonSchema.properties || {};
  const required = new Set(jsonSchema.required || []);
  const lines = [`interface ${name} {`];
  for (const [key, prop] of Object.entries(props)) {
    if (prop.description) lines.push(`  /** ${prop.description} */`);
    const opt = required.has(key) ? '' : '?';
    lines.push(`  ${key}${opt}: ${schemaPropToTs(prop)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

// ─── JSON Schema → Python type hints ─────────────────────────────────────────

const PY_PRIM_MAP = {
  string: 'str', number: 'float', integer: 'int',
  boolean: 'bool', null: 'None', object: 'dict[str, Any]', void: 'None',
};

function primTypeToPy(type) {
  if (!type) return null;
  return PY_PRIM_MAP[type] ?? null;
}

function schemaPropToPy(prop) {
  if (!prop) return 'Any';
  const t = prop.type;
  if (t === 'string') return 'str';
  if (t === 'number' || t === 'integer') return 'float';
  if (t === 'boolean') return 'bool';
  if (t === 'null') return 'None';
  if (t === 'array') return `list[${schemaPropToPy(prop.items)}]`;
  if (t === 'object') return 'dict[str, Any]';
  if (Array.isArray(t)) return t.map((x) => schemaPropToPy({ type: x })).join(' | ');
  return 'Any';
}

// ─── Type resolution ──────────────────────────────────────────────────────────

function readTypeDef(root, typeId) {
  const s = typeId.replace(/-/g, '');
  const typePath = path.join(root, '.kanecta', 'types', s.slice(0, 2), s.slice(2, 4), typeId, 'type.json');
  try {
    return JSON.parse(fs.readFileSync(typePath, 'utf8'));
  } catch {
    return null;
  }
}

function interfaceName(typeDef, typeId) {
  const title = typeDef?.jsonSchema?.title;
  if (title) return title.replace(/\s+/g, '');
  return `KType_${typeId.slice(0, 8)}`;
}

// ─── index.ts builder ────────────────────────────────────────────────────────

function buildIndexTs(fnName, fnData, typeIdMap) {
  const lines = [];

  lines.push('// AUTO-GENERATED — do not edit the function signature.');
  lines.push('// This file is regenerated from function.json on each save.');
  lines.push('// Only edit the body of the function below.');
  lines.push('');

  const usesKanecta = fnData.includeKanectaSdk !== false;
  const extraDeps = fnData.dependencies ?? [];
  if (usesKanecta || extraDeps.length > 0) {
    lines.push('// Dependencies:');
    if (usesKanecta) lines.push('//   @kanecta/lib');
    if (usesKanecta) lines.push('//   @kanecta/datastore-utils');
    for (const dep of extraDeps) lines.push(`//   ${dep}`);
    lines.push('');
  }

  if (usesKanecta) {
    lines.push("import { Datastore } from '@kanecta/lib';");
    lines.push("import { openFilesystemAdapter } from '@kanecta/datastore-utils';");
    lines.push('');
    lines.push('const kanecta = new Datastore(openFilesystemAdapter(process.env.KANECTA_DATASTORE!));');
    lines.push('');
  }

  for (const { name, typeDef } of typeIdMap.values()) {
    if (typeDef?.jsonSchema) {
      lines.push(generateInterface(name, typeDef.jsonSchema));
      lines.push('');
    }
  }

  const jsdocLines = [];
  if (fnData.description) jsdocLines.push(` * ${fnData.description}`);
  for (const p of fnData.parameters ?? []) {
    if (p.description) jsdocLines.push(` * @param ${p.name} - ${p.description}`);
  }
  for (const t of fnData.throws ?? []) {
    const when = t.description ? ` - ${t.description}` : '';
    jsdocLines.push(` * @throws {${t.type}}${when}`);
  }
  if (fnData.deprecated) jsdocLines.push(` * @deprecated ${fnData.deprecated}`);
  if (jsdocLines.length > 0) {
    lines.push('/**');
    lines.push(...jsdocLines);
    lines.push(' */');
  }

  const typeParams = (fnData.typeParameters ?? []).map((tp) => {
    let s = tp.name;
    if (tp.constraint) s += ` extends ${tp.constraint}`;
    if (tp.default) s += ` = ${tp.default}`;
    return s;
  });
  const typeParamsStr = typeParams.length ? `<${typeParams.join(', ')}>` : '';

  const paramStrs = (fnData.parameters ?? []).map((p) => {
    const tsType = p.typeId
      ? (typeIdMap.get(p.typeId)?.name ?? 'unknown')
      : (p.type ?? 'unknown');
    const prefix = p.rest ? '...' : '';
    if (p.defaultValue) {
      const dv = tsType === 'string' && !/^["'`]/.test(p.defaultValue)
        ? `"${p.defaultValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : p.defaultValue;
      return `  ${prefix}${p.name}: ${tsType} = ${dv}`;
    }
    if (p.optional) return `  ${prefix}${p.name}?: ${tsType}`;
    return `  ${prefix}${p.name}: ${tsType}`;
  });

  const returnType = fnData.returnTypeId
    ? (typeIdMap.get(fnData.returnTypeId)?.name ?? 'unknown')
    : (fnData.returnType ?? 'void');

  const asyncKw = fnData.async ? 'async ' : '';

  if (paramStrs.length > 0) {
    lines.push(`export ${asyncKw}function ${fnName}${typeParamsStr}(`);
    lines.push(paramStrs.join(',\n'));
    lines.push(`): ${returnType} {`);
  } else {
    lines.push(`export ${asyncKw}function ${fnName}${typeParamsStr}(): ${returnType} {`);
  }

  if (fnData.body?.trim()) {
    for (const l of fnData.body.split('\n')) {
      lines.push(`  ${l}`);
    }
  } else {
    lines.push('  // TODO: implement');
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ─── TypeScript scaffold ──────────────────────────────────────────────────────

function generateTypescriptScaffold(runtimeDir, itemName, fnData, root) {
  fs.mkdirSync(runtimeDir, { recursive: true });

  const repoRoot = path.resolve(__dirname, '../../..');
  const usesKanecta = fnData.includeKanectaSdk !== false;
  const extraDeps = fnData.dependencies ?? [];
  const dependencies = {};
  if (usesKanecta) {
    const localLibPath = path.join(repoRoot, 'kanecta-lib');
    const localUtilsPath = path.join(repoRoot, 'kanecta-storage-adapters', 'kanecta-datastore-utils');
    if (fs.existsSync(path.join(localLibPath, 'package.json'))) {
      dependencies['@kanecta/lib'] = `file:${localLibPath}`;
      dependencies['@kanecta/datastore-utils'] = `file:${localUtilsPath}`;
    } else {
      dependencies['@kanecta/lib'] = '*';
      dependencies['@kanecta/datastore-utils'] = '*';
    }
  }
  for (const dep of extraDeps) {
    const atIdx = dep.lastIndexOf('@');
    if (atIdx > 0) {
      dependencies[dep.slice(0, atIdx)] = dep.slice(atIdx + 1);
    } else {
      dependencies[dep] = '*';
    }
  }

  fs.writeFileSync(
    path.join(runtimeDir, 'package.json'),
    JSON.stringify({
      name: `kanecta-fn-${slugify(itemName)}`,
      version: '1.0.0',
      private: true,
      scripts: {
        build: 'tsc',
        start: 'ts-node index.ts',
      },
      ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
      devDependencies: {
        typescript: '^5.0.0',
        'ts-node': '^10.9.0',
        '@types/node': '^20.0.0',
      },
    }, null, 2) + '\n',
    'utf8',
  );

  writeIfAbsent(
    path.join(runtimeDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        strict: true,
        esModuleInterop: true,
        outDir: 'dist',
        rootDir: '.',
      },
      include: ['index.ts'],
    }, null, 2) + '\n',
  );

  const typeIdMap = new Map();
  for (const p of fnData.parameters ?? []) {
    if (p.typeId && !typeIdMap.has(p.typeId)) {
      const typeDef = readTypeDef(root, p.typeId);
      typeIdMap.set(p.typeId, { name: interfaceName(typeDef, p.typeId), typeDef });
    }
  }
  if (fnData.returnTypeId && !typeIdMap.has(fnData.returnTypeId)) {
    const typeDef = readTypeDef(root, fnData.returnTypeId);
    typeIdMap.set(fnData.returnTypeId, { name: interfaceName(typeDef, fnData.returnTypeId), typeDef });
  }

  const fnName = toCamelCase(itemName);
  const indexTs = buildIndexTs(fnName, fnData, typeIdMap);
  fs.writeFileSync(path.join(runtimeDir, 'index.ts'), indexTs, 'utf8');
}

// ─── main.py builder ─────────────────────────────────────────────────────────

function buildMainPy(fnName, fnData) {
  const params = fnData.parameters ?? [];

  let needsAny = false;
  const paramAnnotations = params.map((p) => {
    let annotation = '';
    if (p.type) {
      const pyType = primTypeToPy(p.type);
      if (pyType) {
        annotation = `: ${pyType}`;
        if (pyType.includes('Any')) needsAny = true;
      }
    }
    let defaultStr = '';
    if (p.defaultValue !== undefined && p.defaultValue !== null) {
      defaultStr = ` = ${p.defaultValue}`;
    } else if (p.optional) {
      defaultStr = ' = None';
    }
    return `${p.name}${annotation}${defaultStr}`;
  });

  const returnType = fnData.returnType ? primTypeToPy(fnData.returnType) : null;
  if (returnType && returnType.includes('Any')) needsAny = true;
  const returnAnnotation = returnType ? ` -> ${returnType}` : '';

  const lines = [];
  lines.push('# AUTO-GENERATED — do not edit the function signature.');
  lines.push('# This file is regenerated from function.json on each save.');
  lines.push('# Only edit the body of the function below.');
  lines.push('');
  lines.push('from __future__ import annotations');
  if (needsAny) lines.push('from typing import Any');
  lines.push('');

  if (fnData.deprecated) lines.push(`# @deprecated: ${fnData.deprecated}`);

  const sig = `def ${fnName}(${paramAnnotations.join(', ')})${returnAnnotation}:`;
  lines.push(sig);

  const docParts = [];
  if (fnData.description) docParts.push(fnData.description);
  for (const p of params) {
    if (p.description) docParts.push(`\n    :param ${p.name}: ${p.description}`);
  }
  for (const t of fnData.throws ?? []) {
    const when = t.description ? ` ${t.description}` : '';
    docParts.push(`\n    :raises ${t.type}:${when}`);
  }
  if (docParts.length > 0) {
    lines.push(`    """${docParts.join('')}"""`);
  }

  if (fnData.body?.trim()) {
    for (const l of fnData.body.split('\n')) {
      lines.push(`    ${l}`);
    }
  } else {
    lines.push('    ...');
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Python scaffold ──────────────────────────────────────────────────────────

function generatePythonScaffold(runtimeDir, itemName, fnData) {
  fs.mkdirSync(runtimeDir, { recursive: true });

  const usesKanecta = fnData.includeKanectaSdk !== false;
  const extraDeps = fnData.dependencies ?? [];
  const reqs = [];
  if (usesKanecta) reqs.push('# kanecta-sdk  # TODO: Python SDK not yet available');
  for (const dep of extraDeps) reqs.push(dep);
  fs.writeFileSync(
    path.join(runtimeDir, 'requirements.txt'),
    reqs.join('\n') + (reqs.length ? '\n' : ''),
    'utf8',
  );

  const fnName = toPythonName(itemName);
  const mainPy = buildMainPy(fnName, fnData);
  fs.writeFileSync(path.join(runtimeDir, 'main.py'), mainPy, 'utf8');
}

// ─── Main export ──────────────────────────────────────────────────────────────

// Generates (or regenerates) the scaffold for a function item.
// runtimeDir is created at <itemDir>/.function/<runtime>/.
// Returns the runtimeDir path so callers can hash it.
function generateFunctionScaffold(itemDir, itemName, fnData, root) {
  const runtime = fnData.runtime ?? 'typescript';
  if (!VALID_RUNTIME_RE.test(runtime)) {
    throw new Error(`Invalid runtime name: "${runtime}". Must be lowercase letters, hyphens, digits.`);
  }
  const runtimeDir = getRuntimeDir(itemDir, runtime);
  if (runtime === 'python') {
    generatePythonScaffold(runtimeDir, itemName, fnData);
  } else {
    generateTypescriptScaffold(runtimeDir, itemName, fnData, root ?? '');
  }
  return runtimeDir;
}

module.exports = {
  generateFunctionScaffold,
  getRuntimeDir,
  computeBundleHash,
  toCamelCase,
  toPythonName,
  VALID_RUNTIME_RE,
};
