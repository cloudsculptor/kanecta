'use strict';

const fs = require('fs');
const path = require('path');

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

function writeIfAbsent(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
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

  const usesSdk = fnData.includeKanectaSdk !== false;
  const extraDeps = fnData.dependencies ?? [];
  if (usesSdk || extraDeps.length > 0) {
    lines.push('// Dependencies:');
    if (usesSdk) lines.push('//   @kanecta/sdk');
    for (const dep of extraDeps) lines.push(`//   ${dep}`);
    lines.push('');
  }

  if (usesSdk) {
    lines.push("import { createClient } from '@kanecta/sdk';");
    lines.push('');
    lines.push('const kanecta = createClient();');
    lines.push('');
  }

  // Interfaces for Kanecta-typed args
  for (const { name, typeDef } of typeIdMap.values()) {
    if (typeDef?.jsonSchema) {
      lines.push(generateInterface(name, typeDef.jsonSchema));
      lines.push('');
    }
  }

  // JSDoc
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

  // Generic type parameters
  const typeParams = (fnData.typeParameters ?? []).map((tp) => {
    let s = tp.name;
    if (tp.constraint) s += ` extends ${tp.constraint}`;
    if (tp.default) s += ` = ${tp.default}`;
    return s;
  });
  const typeParamsStr = typeParams.length ? `<${typeParams.join(', ')}>` : '';

  // Parameters
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

  // Return type
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

// ─── Main export ──────────────────────────────────────────────────────────────

function generateFunctionScaffold(itemDir, itemName, fnData, root) {
  const fnDir = path.join(itemDir, 'function');
  fs.mkdirSync(fnDir, { recursive: true });

  // package.json — always regenerated so dependencies stay in sync with function.json
  const usesSdk = fnData.includeKanectaSdk !== false;
  const extraDeps = fnData.dependencies ?? [];
  const dependencies = {};
  if (usesSdk) dependencies['@kanecta/sdk'] = '*';
  for (const dep of extraDeps) {
    const atIdx = dep.lastIndexOf('@');
    if (atIdx > 0) {
      dependencies[dep.slice(0, atIdx)] = dep.slice(atIdx + 1);
    } else {
      dependencies[dep] = '*';
    }
  }
  fs.writeFileSync(
    path.join(fnDir, 'package.json'),
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

  // tsconfig.json — once
  writeIfAbsent(
    path.join(fnDir, 'tsconfig.json'),
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

  // Resolve Kanecta types
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

  // index.ts — always regenerate
  const fnName = toCamelCase(itemName);
  const indexTs = buildIndexTs(fnName, fnData, typeIdMap);
  fs.writeFileSync(path.join(fnDir, 'index.ts'), indexTs, 'utf8');
}

module.exports = { generateFunctionScaffold, toCamelCase };
