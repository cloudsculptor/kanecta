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

/**
 * Validates a `kanecta.item.json` file for a UI component package.
 *
 * Checks that the item is type "component", has a stable UUID, the root parent,
 * a human-readable value, all required meta fields, `meta.files.body` pointing
 * into `src/`, and a valid `payload` with a `props` array.
 */
export function validateComponentItem(json: unknown): ValidationResult;

/**
 * Validates a `kanecta.manifest.json` for a Kanecta UI app.
 *
 * Checks `schemaVersion` semver, `layer === "ui"`, non-empty `package`,
 * items array with UUID `id`, string `type`, and string `file` per entry,
 * and that no two entries share the same `id`.
 */
export function validateManifest(json: unknown): ValidationResult;

/**
 * Validates a component `package.json` against Kanecta UI conventions.
 *
 * Checks name pattern, `private: true`, `main` pointing into `src/`,
 * absence of a `dependencies` block, `react` in peerDependencies,
 * and that all peer ranges use `>=` rather than `^`.
 */
export function validateComponentPackage(pkg: unknown): ValidationResult;
