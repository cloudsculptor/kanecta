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

/**
 * Validates a type.json object against Kanecta Schema rules.
 *
 * Enforces structural shape AND Kanecta business rules:
 *  - Every `jsonSchema.properties` entry must carry an `x-id` (stable UUID).
 *  - Types must be flat: no nested objects, no arrays-of-objects, no `$ref`.
 *  - `sqlSchema` must be a non-empty array of SQL DDL strings.
 *  - `meta.description` is required.
 */
export function validateType(typeJson: unknown): ValidationResult;

/**
 * Validates a metadata.json object.
 *
 * Checks required fields, UUID formats, ISO 8601 timestamps,
 * valid type strings, visibility enum, and the `object`→`typeId` rule.
 */
export function validateMetadata(meta: unknown): ValidationResult;

/**
 * Validates item data against a type's `jsonSchema`.
 *
 * Checks required fields, primitive types, UUID / date / date-time formats,
 * enum and const constraints.
 *
 * @param data     - The item's field data object (loaded from items.json or the database).
 * @param typeJson - The fully-parsed type.json for this item's type.
 */
export function validateItem(data: unknown, typeJson: object): ValidationResult;

/**
 * Validates a function.json object.
 *
 * Checks parameters (name, type/typeId exclusivity, no inline objects),
 * returnType/returnTypeId exclusivity, UUID formats, and boolean fields.
 */
export function validateFunction(fn: unknown): ValidationResult;
