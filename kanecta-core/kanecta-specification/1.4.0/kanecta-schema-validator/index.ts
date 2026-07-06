import { createHash } from 'crypto';

export interface ValidationError {
  /** Dot-notation path to the offending field (e.g. "jsonSchema.properties.name"). */
  path: string;
  /** Human-readable explanation of the failure. */
  message: string;
  /**
   * Machine-readable rule identifier.
   *
   * Standard JSON Schema rules:  "required" | "type" | "format:uuid" | "format:date-time" |
   *                               "format:date" | "const" | "enum" | "exclusive"
   *
   * Kanecta-specific rules:       "kanecta:x-id-required"        | "kanecta:flat"                  |
   *                               "kanecta:no-ref"               | "kanecta:valid-type"            |
   *                               "kanecta:object-requires-typeid" | "kanecta:no-object-type"      |
   *                               "kanecta:immutable-requires-hash" | "kanecta:hash-mismatch"
   */
  rule: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ─── helpers ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isUUID    = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v);
const isISO8601 = (v: unknown): boolean => typeof v === 'string' && ISO8601_RE.test(v);
const isDate    = (v: unknown): boolean => typeof v === 'string' && DATE_RE.test(v);
const e = (path: string, message: string, rule: string): ValidationError => ({ path, message, rule });

// Valid item type strings — mirrors 1.4.0/types/primitive.json
const ALL_ITEM_TYPES = new Set([
  'string','number','text','heading','file','symlink','url','image',
  'function','markdown','runner',
  'object','decision','annotation','claim','question','task','note',
  'concept','entity','event',
  'root','types',
  'type',
]);

const VISIBILITY   = new Set(['private','organisation','public']);
const UUID_ARRAYS  = ['sync','supersededBy','implements','extends'];

function computeContractHash(typeJson: any): string {
  const contract = {
    jsonSchema:   typeJson.jsonSchema   ?? null,
    sqlSchema:    typeJson.sqlSchema    ?? null,
    primaryField: typeJson.meta?.primaryField ?? null,
  };
  const canonical = JSON.stringify(contract, Object.keys(contract).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

// ─── validateType ────────────────────────────────────────────────────────────

/**
 * Validates a type.json object against Kanecta Schema rules.
 *
 * Business rules enforced on top of structural checks:
 *  - Every property in jsonSchema.properties must have an "x-id" (stable UUID).
 *  - Types must be flat: no nested objects, no arrays-of-objects, no $ref.
 *  - sqlSchema must be a non-empty array of SQL DDL strings.
 *  - meta.description is required.
 */
export function validateType(typeJsonInput: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof typeJsonInput !== 'object' || typeJsonInput === null || Array.isArray(typeJsonInput)) {
    return { valid: false, errors: [e('', 'type.json must be a non-null object', 'type')] };
  }
  const typeJson: any = typeJsonInput;

  for (const f of ['meta', 'jsonSchema', 'sqlSchema']) {
    if (typeJson[f] == null) errors.push(e(f, `Required field "${f}" is missing`, 'required'));
  }

  const meta = typeJson.meta;
  if (meta && typeof meta === 'object') {
    if (!meta.description) {
      errors.push(e('meta.description', 'meta.description is required', 'required'));
    }

    for (const f of UUID_ARRAYS) {
      const v = meta[f];
      if (v == null) continue;
      if (!Array.isArray(v)) {
        errors.push(e(`meta.${f}`, `"meta.${f}" must be an array`, 'type'));
      } else {
        v.forEach((u: unknown, i: number) => {
          if (!isUUID(u)) errors.push(e(`meta.${f}[${i}]`, `Not a valid UUID: "${u}"`, 'format:uuid'));
        });
      }
    }

    if (meta.immutable != null && typeof meta.immutable !== 'boolean') {
      errors.push(e('meta.immutable', 'meta.immutable must be a boolean', 'type'));
    }
    if (meta.hash != null && typeof meta.hash !== 'string') {
      errors.push(e('meta.hash', 'meta.hash must be a string', 'type'));
    }

    const fns = meta.functions;
    if (fns != null) {
      if (!Array.isArray(fns)) {
        errors.push(e('meta.functions', 'meta.functions must be an array of UUIDs', 'type'));
      } else {
        fns.forEach((u: unknown, i: number) => {
          if (!isUUID(u)) errors.push(e(`meta.functions[${i}]`, `Not a valid UUID: "${u}"`, 'format:uuid'));
        });
      }
    }

    // Hash check: when immutable, verify meta.hash matches the contract
    if (meta.immutable === true) {
      if (!meta.hash) {
        errors.push(e('meta.hash',
          'meta.hash is required when meta.immutable is true',
          'kanecta:immutable-requires-hash'));
      } else if (typeJson.jsonSchema && typeJson.sqlSchema) {
        const expected = computeContractHash(typeJson);
        if (meta.hash !== expected) {
          errors.push(e('meta.hash',
            `meta.hash does not match the contract (jsonSchema + sqlSchema + meta.primaryField). Expected "${expected}"`,
            'kanecta:hash-mismatch'));
        }
      }
    }
  }

  const js = typeJson.jsonSchema;
  if (js && typeof js === 'object') {
    if (js.$schema !== 'http://json-schema.org/draft-07/schema#') {
      errors.push(e('jsonSchema.$schema',
        `Must be "http://json-schema.org/draft-07/schema#", got "${js.$schema}"`, 'const'));
    }
    if (js.type !== 'object') {
      errors.push(e('jsonSchema.type', `Must be "object", got "${js.type}"`, 'const'));
    }

    const props = js.properties;
    if (!props || typeof props !== 'object') {
      errors.push(e('jsonSchema.properties', 'jsonSchema.properties must be an object', 'required'));
    } else {
      for (const [name, prop] of Object.entries<any>(props)) {
        const base = `jsonSchema.properties.${name}`;
        if (typeof prop !== 'object' || prop === null) {
          errors.push(e(base, `Property definition for "${name}" must be an object`, 'type'));
          continue;
        }

        if (!prop['x-id']) {
          errors.push(e(base,
            `Property "${name}" is missing "x-id" — every Kanecta type field requires a stable UUID so it can survive renames`,
            'kanecta:x-id-required'));
        } else if (!isUUID(prop['x-id'])) {
          errors.push(e(`${base}["x-id"]`,
            `x-id must be a valid UUID, got "${prop['x-id']}"`, 'format:uuid'));
        }

        if (prop.$ref) {
          errors.push(e(base,
            `Property "${name}" uses $ref — Kanecta uses typeId (a UUID string) instead of $ref`,
            'kanecta:no-ref'));
        }
        if (prop.type === 'object') {
          errors.push(e(base,
            `Property "${name}" has type "object" — Kanecta types must be flat; model this concept as its own child type and reference it via typeId`,
            'kanecta:flat'));
        }
        if (prop.type === 'array' && prop.items) {
          if (prop.items.type === 'object') {
            errors.push(e(`${base}.items`,
              `Array items for "${name}" must be primitives, not objects — model this as a child type`,
              'kanecta:flat'));
          }
          if (prop.items.$ref) {
            errors.push(e(`${base}.items`,
              `Array items for "${name}" use $ref — use format:uuid with typeId instead`,
              'kanecta:no-ref'));
          }
        }
      }
    }
  }

  const sql = typeJson.sqlSchema;
  if (sql != null) {
    if (!Array.isArray(sql) || sql.length === 0) {
      errors.push(e('sqlSchema', 'sqlSchema must be a non-empty array of SQL DDL strings', 'required'));
    } else {
      sql.forEach((s: unknown, i: number) => {
        if (typeof s !== 'string') {
          errors.push(e(`sqlSchema[${i}]`, `sqlSchema entries must be strings, got ${typeof s}`, 'type'));
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── validateMetadata ────────────────────────────────────────────────────────

/**
 * Validates a metadata.json object.
 */
export function validateMetadata(metaInput: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof metaInput !== 'object' || metaInput === null || Array.isArray(metaInput)) {
    return { valid: false, errors: [e('', 'metadata.json must be a non-null object', 'type')] };
  }
  const meta: any = metaInput;

  if (!('parentId' in meta)) {
    errors.push(e('parentId', 'Required field "parentId" is missing', 'required'));
  }

  for (const f of ['id', 'value', 'type', 'owner', 'license', 'createdAt', 'modifiedAt']) {
    if (meta[f] == null) errors.push(e(f, `Required field "${f}" is missing or null`, 'required'));
  }

  if (meta.id      != null && !isUUID(meta.id))      errors.push(e('id',      `id must be a valid UUID, got "${meta.id}"`,           'format:uuid'));
  if (meta.license != null && !isUUID(meta.license))  errors.push(e('license', `license must be a valid UUID, got "${meta.license}"`, 'format:uuid'));
  if (meta.typeId  != null && !isUUID(meta.typeId))   errors.push(e('typeId',  `typeId must be a valid UUID, got "${meta.typeId}"`,   'format:uuid'));

  if (meta.type === 'object' && !meta.typeId) {
    errors.push(e('typeId', 'Items of type "object" must have a typeId', 'kanecta:object-requires-typeid'));
  }

  if (meta.type != null && !ALL_ITEM_TYPES.has(meta.type)) {
    errors.push(e('type',
      `Unknown type "${meta.type}". Valid types: ${[...ALL_ITEM_TYPES].join(', ')}`,
      'kanecta:valid-type'));
  }

  for (const f of ['createdAt', 'modifiedAt']) {
    if (meta[f] != null && !isISO8601(meta[f])) {
      errors.push(e(f, `${f} must be an ISO 8601 datetime string, got "${meta[f]}"`, 'format:date-time'));
    }
  }
  for (const f of ['cachedAt', 'subscribedAt', 'completedAt', 'dueAt']) {
    if (meta[f] != null && !isISO8601(meta[f])) {
      errors.push(e(f, `${f} must be an ISO 8601 datetime string or null, got "${meta[f]}"`, 'format:date-time'));
    }
  }

  if (meta.visibility != null && !VISIBILITY.has(meta.visibility)) {
    errors.push(e('visibility',
      `visibility must be one of: ${[...VISIBILITY].join(', ')}, got "${meta.visibility}"`, 'enum'));
  }

  if (meta.tags != null) {
    if (!Array.isArray(meta.tags)) {
      errors.push(e('tags', 'tags must be an array', 'type'));
    } else {
      meta.tags.forEach((t: unknown, i: number) => {
        if (typeof t !== 'string') errors.push(e(`tags[${i}]`, 'Each tag must be a string', 'type'));
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── validateItem ─────────────────────────────────────────────────────────────

/**
 * Validates item data against a type's jsonSchema.
 * Checks required fields, types, and formats (uuid, date, date-time).
 *
 * @param data     - The item's field data object.
 * @param typeJson - The type.json for this item's type.
 */
export function validateItem(dataInput: unknown, typeJsonInput: object): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof dataInput !== 'object' || dataInput === null || Array.isArray(dataInput)) {
    return { valid: false, errors: [e('', 'Item data must be a non-null object', 'type')] };
  }
  const data: any = dataInput;
  const typeJson: any = typeJsonInput;
  if (!typeJson || typeof typeJson.jsonSchema !== 'object') {
    return { valid: false, errors: [e('', 'typeJson with a jsonSchema object is required', 'required')] };
  }

  const props    = typeJson.jsonSchema.properties || {};
  const required = typeJson.jsonSchema.required   || [];

  for (const f of required) {
    if (data[f] == null) errors.push(e(f, `Required field "${f}" is missing or null`, 'required'));
  }

  for (const [name, def] of Object.entries<any>(props)) {
    const val = data[name];
    if (val == null) continue;

    const t   = def.type;
    const fmt = def.format;

    if (t === 'string') {
      if (typeof val !== 'string') {
        errors.push(e(name, `Expected string, got ${typeof val}`, 'type'));
      } else if (fmt === 'uuid' && !isUUID(val)) {
        errors.push(e(name, `Expected a valid UUID, got "${val}"`, 'format:uuid'));
      } else if (fmt === 'date-time' && !isISO8601(val)) {
        errors.push(e(name, `Expected ISO 8601 datetime, got "${val}"`, 'format:date-time'));
      } else if (fmt === 'date' && !isDate(val)) {
        errors.push(e(name, `Expected date (YYYY-MM-DD), got "${val}"`, 'format:date'));
      }
    } else if (t === 'number') {
      if (typeof val !== 'number') errors.push(e(name, `Expected number, got ${typeof val}`, 'type'));
    } else if (t === 'integer') {
      if (!Number.isInteger(val)) errors.push(e(name, `Expected integer, got ${val}`, 'type'));
    } else if (t === 'boolean') {
      if (typeof val !== 'boolean') errors.push(e(name, `Expected boolean, got ${typeof val}`, 'type'));
    } else if (t === 'array') {
      if (!Array.isArray(val)) {
        errors.push(e(name, `Expected array, got ${typeof val}`, 'type'));
      } else if (def.items) {
        const it   = def.items.type;
        const ifmt = def.items.format;
        val.forEach((v: unknown, i: number) => {
          if (it === 'string') {
            if (typeof v !== 'string') {
              errors.push(e(`${name}[${i}]`, `Expected string, got ${typeof v}`, 'type'));
            } else if (ifmt === 'uuid' && !isUUID(v)) {
              errors.push(e(`${name}[${i}]`, `Expected a valid UUID, got "${v}"`, 'format:uuid'));
            }
          } else if (it === 'number'  && typeof v !== 'number')  { errors.push(e(`${name}[${i}]`, `Expected number, got ${typeof v}`, 'type')); }
          else if   (it === 'integer' && !Number.isInteger(v))   { errors.push(e(`${name}[${i}]`, `Expected integer, got ${v}`, 'type')); }
          else if   (it === 'boolean' && typeof v !== 'boolean') { errors.push(e(`${name}[${i}]`, `Expected boolean, got ${typeof v}`, 'type')); }
        });
      }
    }

    if (def.enum && !def.enum.includes(val)) {
      errors.push(e(name, `"${val}" is not one of the allowed values: ${def.enum.join(', ')}`, 'enum'));
    }
    if (def.const !== undefined && val !== def.const) {
      errors.push(e(name, `Value must be exactly "${def.const}", got "${val}"`, 'const'));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── validateFunction ────────────────────────────────────────────────────────

/**
 * Validates a function.json object.
 */
export function validateFunction(fnInput: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof fnInput !== 'object' || fnInput === null || Array.isArray(fnInput)) {
    return { valid: false, errors: [e('', 'function.json must be a non-null object', 'type')] };
  }
  const fn: any = fnInput;

  if (!Array.isArray(fn.parameters)) {
    errors.push(e('parameters', 'parameters must be an array', 'required'));
  } else {
    fn.parameters.forEach((p: any, i: number) => {
      const base = `parameters[${i}]`;
      if (!p.name) errors.push(e(`${base}.name`, 'Parameter name is required', 'required'));
      if (!p.type && !p.typeId) {
        errors.push(e(base, `Parameter "${p.name ?? i}" must have either type or typeId`, 'required'));
      }
      if (p.type && p.typeId) {
        errors.push(e(base, `Parameter "${p.name ?? i}" must have type or typeId, not both`, 'exclusive'));
      }
      if (p.typeId != null && !isUUID(p.typeId)) {
        errors.push(e(`${base}.typeId`, `typeId must be a valid UUID, got "${p.typeId}"`, 'format:uuid'));
      }
      if (p.type && /\{/.test(p.type)) {
        errors.push(e(`${base}.type`,
          `Parameter type "${p.type}" contains an inline object — use typeId instead`,
          'kanecta:no-object-type'));
      }
    });
  }

  if (!fn.returnType && !fn.returnTypeId) {
    errors.push(e('', 'Either returnType or returnTypeId is required', 'required'));
  }
  if (fn.returnType && fn.returnTypeId) {
    errors.push(e('', 'returnType and returnTypeId are mutually exclusive', 'exclusive'));
  }
  if (fn.returnTypeId != null && !isUUID(fn.returnTypeId)) {
    errors.push(e('returnTypeId', `returnTypeId must be a valid UUID, got "${fn.returnTypeId}"`, 'format:uuid'));
  }
  if (fn.returnType && /\{/.test(fn.returnType)) {
    errors.push(e('returnType',
      `returnType "${fn.returnType}" contains an inline object — use returnTypeId instead`,
      'kanecta:no-object-type'));
  }

  if (fn.skill != null && !isUUID(fn.skill)) {
    errors.push(e('skill', `skill must be a valid UUID, got "${fn.skill}"`, 'format:uuid'));
  }

  for (const f of ['async', 'ai', 'includeKanectaSdk']) {
    if (fn[f] != null && typeof fn[f] !== 'boolean') {
      errors.push(e(f, `${f} must be a boolean`, 'type'));
    }
  }

  return { valid: errors.length === 0, errors };
}
