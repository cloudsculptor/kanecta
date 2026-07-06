export interface ValidationError {
  /** Dot-notation path to the offending field (e.g. "item.type", "payload.props[0].name"). */
  path: string;
  /** Human-readable explanation of the failure. */
  message: string;
  /**
   * Machine-readable rule identifier.
   *
   * Standard rules:        "required" | "type" | "enum" | "exclusive" |
   *                        "format:uuid" | "format:date-time" | "format:semver"
   *
   * Kanecta UI rules:      "kanecta-ui:component-type"    — item.type must be "component"
   *                        "kanecta-ui:non-root-id"        — item.id must not be the root UUID
   *                        "kanecta-ui:root-parent"        — item.parentId must be root UUID
   *                        "kanecta-ui:files-required"     — meta.files must be present
   *                        "kanecta-ui:body-required"      — meta.files.body must be set
   *                        "kanecta-ui:body-path"          — meta.files.body must start with src/
   *                        "kanecta-ui:payload-required"   — payload must be present
   *                        "kanecta-ui:props-required"     — payload.props must be an array
   *                        "kanecta-ui:layer"              — manifest layer must be "ui"
   *                        "kanecta-ui:duplicate-id"       — manifest item IDs must be unique
   *                        "kanecta-ui:component-name"     — package name must match @kanecta/component-*
   *                        "kanecta-ui:private"            — package must be private
   *                        "kanecta-ui:main-src"           — main must point into src/
   *                        "kanecta-ui:no-dependencies"    — dependencies block is forbidden
   *                        "kanecta-ui:peer-deps-required" — peerDependencies must be present
   *                        "kanecta-ui:react-peer"         — react must be a peer dependency
   *                        "kanecta-ui:peer-range"         — peer ranges must use >= not ^
   */
  rule: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ─── helpers ────────────────────────────────────────────────────────────────

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SEMVER_RE  = /^\d+\.\d+\.\d+$/;
const COMPONENT_NAME_RE   = /^@kanecta\/component-[a-z][a-z0-9-]*$/;
const COMPONENT_FOLDER_RE = /^kanecta-component-[a-z][a-z0-9-]*$/;
const ROOT_UUID  = '00000000-0000-0000-0000-000000000000';
const VISIBILITY = new Set(['private', 'organisation', 'public']);

function isUUID(v: unknown): boolean    { return typeof v === 'string' && UUID_RE.test(v); }
function isISO8601(v: unknown): boolean { return typeof v === 'string' && ISO8601_RE.test(v); }
function isSemver(v: unknown): boolean  { return typeof v === 'string' && SEMVER_RE.test(v); }
function e(path: string, message: string, rule: string): ValidationError { return { path, message, rule }; }

// ─── validateComponentItem ───────────────────────────────────────────────────

/**
 * Validates a kanecta.item.json file for a UI component package.
 *
 * Enforces:
 *  - item.type must be "component"
 *  - item.id must be a stable UUID v4 (not the root UUID)
 *  - item.parentId must be the well-known root UUID
 *  - item.value must be a non-empty string (human-readable display name)
 *  - Required meta fields present and correctly typed
 *  - meta.files.body must point to the component source entry
 *  - payload.props must be an array
 *  - payload.dependencies must be an array of strings if present
 */
export function validateComponentItem(json: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { valid: false, errors: [e('', 'kanecta.item.json must be a non-null object', 'type')] };
  }

  const root = json as any;

  // ── item section ──────────────────────────────────────────────────────────

  const item = root.item;
  if (!item || typeof item !== 'object') {
    errors.push(e('item', 'Required section "item" is missing', 'required'));
  } else {
    if (!item.id) {
      errors.push(e('item.id', 'item.id is required', 'required'));
    } else if (!isUUID(item.id)) {
      errors.push(e('item.id', `item.id must be a valid UUID v4, got "${item.id}"`, 'format:uuid'));
    } else if (item.id === ROOT_UUID) {
      errors.push(e('item.id', 'item.id must not be the root UUID — each component needs a unique stable identity', 'kanecta-ui:non-root-id'));
    }

    if (!('parentId' in item)) {
      errors.push(e('item.parentId', 'item.parentId is required', 'required'));
    } else if (item.parentId !== ROOT_UUID) {
      errors.push(e('item.parentId', `item.parentId must be the root UUID "${ROOT_UUID}" for component packages, got "${item.parentId}"`, 'kanecta-ui:root-parent'));
    }

    if (item.type !== 'component') {
      errors.push(e('item.type', `item.type must be "component" for UI component packages, got "${item.type}"`, 'kanecta-ui:component-type'));
    }

    if (!item.value || typeof item.value !== 'string' || item.value.trim() === '') {
      errors.push(e('item.value', 'item.value must be a non-empty display name string', 'required'));
    }
  }

  // ── meta section ──────────────────────────────────────────────────────────

  const meta = root.meta;
  if (!meta || typeof meta !== 'object') {
    errors.push(e('meta', 'Required section "meta" is missing', 'required'));
  } else {
    for (const f of ['specVersion', 'owner', 'license', 'createdAt', 'modifiedAt', 'visibility']) {
      if (meta[f] == null) errors.push(e(`meta.${f}`, `Required field "meta.${f}" is missing`, 'required'));
    }

    if (meta.specVersion != null && !isSemver(meta.specVersion)) {
      errors.push(e('meta.specVersion', `meta.specVersion must be a semver string, got "${meta.specVersion}"`, 'format:semver'));
    }

    if (meta.license != null && !isUUID(meta.license)) {
      errors.push(e('meta.license', `meta.license must be a valid UUID, got "${meta.license}"`, 'format:uuid'));
    }

    for (const f of ['createdAt', 'modifiedAt']) {
      if (meta[f] != null && !isISO8601(meta[f])) {
        errors.push(e(`meta.${f}`, `meta.${f} must be an ISO 8601 datetime string, got "${meta[f]}"`, 'format:date-time'));
      }
    }

    if (meta.visibility != null && !VISIBILITY.has(meta.visibility)) {
      errors.push(e('meta.visibility', `meta.visibility must be one of: ${[...VISIBILITY].join(', ')}, got "${meta.visibility}"`, 'enum'));
    }

    // files.body is required — points to the component source entry
    const files = meta.files;
    if (!files || typeof files !== 'object') {
      errors.push(e('meta.files', 'meta.files must be an object — component packages require at least { body: "src/index.ts" }', 'kanecta-ui:files-required'));
    } else if (!files.body || typeof files.body !== 'string') {
      errors.push(e('meta.files.body', 'meta.files.body must be a string pointing to the component source entry (e.g. "src/index.ts")', 'kanecta-ui:body-required'));
    } else if (!files.body.startsWith('src/')) {
      errors.push(e('meta.files.body', `meta.files.body should point into src/ (e.g. "src/index.ts"), got "${files.body}"`, 'kanecta-ui:body-path'));
    }

    if (meta.tags != null) {
      if (!Array.isArray(meta.tags)) {
        errors.push(e('meta.tags', 'meta.tags must be an array of strings', 'type'));
      } else {
        meta.tags.forEach((t: any, i: number) => {
          if (typeof t !== 'string') errors.push(e(`meta.tags[${i}]`, 'Each tag must be a string', 'type'));
        });
      }
    }
  }

  // ── payload section ───────────────────────────────────────────────────────

  if (root.payload == null) {
    errors.push(e('payload', 'payload is required for component items', 'kanecta-ui:payload-required'));
  } else if (typeof root.payload !== 'object' || Array.isArray(root.payload)) {
    errors.push(e('payload', 'payload must be a non-null object', 'type'));
  } else {
    const payload = root.payload;

    if (!Array.isArray(payload.props)) {
      errors.push(e('payload.props', 'payload.props must be an array (may be empty)', 'kanecta-ui:props-required'));
    } else {
      payload.props.forEach((p: any, i: number) => {
        if (!p.name) errors.push(e(`payload.props[${i}].name`, 'Each prop must have a name', 'required'));
        const hasType = !!p.type;
        const hasTypeId = !!p.typeId;
        const hasFunctionId = !!p.functionId;
        const count = [hasType, hasTypeId, hasFunctionId].filter(Boolean).length;
        if (count === 0) {
          errors.push(e(`payload.props[${i}]`, `Prop "${p.name || i}" must have one of: type, typeId, or functionId`, 'required'));
        }
        if (count > 1) {
          errors.push(e(`payload.props[${i}]`, `Prop "${p.name || i}" must have exactly one of: type, typeId, or functionId`, 'exclusive'));
        }
      });
    }

    if (payload.dependencies != null) {
      if (!Array.isArray(payload.dependencies)) {
        errors.push(e('payload.dependencies', 'payload.dependencies must be an array of strings', 'type'));
      } else {
        payload.dependencies.forEach((d: any, i: number) => {
          if (typeof d !== 'string') {
            errors.push(e(`payload.dependencies[${i}]`, 'Each dependency must be a string (npm package name)', 'type'));
          }
        });
      }
    }

    if (payload.description != null && typeof payload.description !== 'string') {
      errors.push(e('payload.description', 'payload.description must be a string', 'type'));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── validateManifest ────────────────────────────────────────────────────────

/**
 * Validates a kanecta.manifest.json for a Kanecta UI app.
 *
 * Enforces:
 *  - schemaVersion must be a semver string
 *  - package must be a non-empty string
 *  - layer must be "ui"
 *  - items must be an array
 *  - Each item must have a UUID id, a string type, and a string file path
 */
export function validateManifest(json: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { valid: false, errors: [e('', 'kanecta.manifest.json must be a non-null object', 'type')] };
  }

  const root = json as any;

  if (!root.schemaVersion) {
    errors.push(e('schemaVersion', 'schemaVersion is required', 'required'));
  } else if (!isSemver(root.schemaVersion)) {
    errors.push(e('schemaVersion', `schemaVersion must be a semver string (e.g. "1.4.0"), got "${root.schemaVersion}"`, 'format:semver'));
  }

  if (!root.package || typeof root.package !== 'string') {
    errors.push(e('package', 'package must be a non-empty string (the app package name)', 'required'));
  }

  if (root.layer !== 'ui') {
    errors.push(e('layer', `layer must be "ui" for UI app manifests, got "${root.layer}"`, 'kanecta-ui:layer'));
  }

  if (!Array.isArray(root.items)) {
    errors.push(e('items', 'items must be an array', 'required'));
  } else {
    root.items.forEach((item: any, i: number) => {
      const base = `items[${i}]`;
      if (typeof item !== 'object' || item === null) {
        errors.push(e(base, 'Each manifest item must be an object', 'type'));
        return;
      }

      if (!item.id) {
        errors.push(e(`${base}.id`, 'id is required', 'required'));
      } else if (!isUUID(item.id)) {
        errors.push(e(`${base}.id`, `id must be a valid UUID, got "${item.id}"`, 'format:uuid'));
      }

      if (!item.type || typeof item.type !== 'string') {
        errors.push(e(`${base}.type`, 'type must be a non-empty string', 'required'));
      }

      if (!item.file || typeof item.file !== 'string') {
        errors.push(e(`${base}.file`, 'file must be a non-empty string path to the kanecta.item.json', 'required'));
      }
    });

    // Detect duplicate IDs
    const seen = new Map<any, number>();
    root.items.forEach((item: any, i: number) => {
      if (!item || !item.id) return;
      if (seen.has(item.id)) {
        errors.push(e(`items[${i}].id`, `Duplicate item ID "${item.id}" — each component must appear once`, 'kanecta-ui:duplicate-id'));
      }
      seen.set(item.id, i);
    });
  }

  return { valid: errors.length === 0, errors };
}

// ─── validateComponentPackage ────────────────────────────────────────────────

/**
 * Validates a component package.json against Kanecta UI conventions.
 *
 * Enforces:
 *  - name matches @kanecta/component-<slug>
 *  - private is true
 *  - main points to src/ (src/index.ts or src/index.tsx)
 *  - no "dependencies" block (only peerDependencies allowed)
 *  - peerDependency version ranges use >= not ^
 *  - react is listed as a peer dependency
 */
export function validateComponentPackage(pkg: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    return { valid: false, errors: [e('', 'package.json must be a non-null object', 'type')] };
  }

  const p = pkg as any;

  if (!p.name || typeof p.name !== 'string') {
    errors.push(e('name', 'name is required', 'required'));
  } else if (!COMPONENT_NAME_RE.test(p.name)) {
    errors.push(e('name', `name must match @kanecta/component-<slug>, got "${p.name}"`, 'kanecta-ui:component-name'));
  }

  if (p.private !== true) {
    errors.push(e('private', 'private must be true — component packages are workspace-only and must not be independently published', 'kanecta-ui:private'));
  }

  if (!p.main || typeof p.main !== 'string') {
    errors.push(e('main', 'main is required', 'required'));
  } else if (!p.main.startsWith('src/')) {
    errors.push(e('main', `main must point into src/ (e.g. "src/index.ts"), got "${p.main}" — no build step; TypeScript sources are consumed directly`, 'kanecta-ui:main-src'));
  }

  if (p.dependencies && Object.keys(p.dependencies).length > 0) {
    errors.push(e('dependencies', '"dependencies" must not be present in component packages — use peerDependencies for runtime deps and devDependencies for type-only or build tools', 'kanecta-ui:no-dependencies'));
  }

  const peers = p.peerDependencies;
  if (!peers || typeof peers !== 'object') {
    errors.push(e('peerDependencies', 'peerDependencies is required — at minimum react must be listed', 'kanecta-ui:peer-deps-required'));
  } else {
    if (!peers.react) {
      errors.push(e('peerDependencies.react', 'react must be listed as a peer dependency', 'kanecta-ui:react-peer'));
    }

    for (const [dep, range] of Object.entries(peers) as [string, any][]) {
      if (dep === '@kanecta/component-core' || dep.startsWith('@kanecta/component-')) continue; // workspace refs use *
      if (range === '*') continue;

      if (/^\^/.test(range)) {
        errors.push(e(
          `peerDependencies.${dep}`,
          `"${dep}" uses a caret range ("${range}") — use >= instead (e.g. ">=19") so the consuming app's already-installed version is always compatible`,
          'kanecta-ui:peer-range',
        ));
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
