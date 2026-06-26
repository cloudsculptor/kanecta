import types from './1.4.0/types/built-in-types.json' with { type: 'json' };
import itemSpec from './1.4.0/file-specs/item.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };

export const version = pkg.version;
export const item = itemSpec;
export { types };
export const allTypes = [...types.primitive, ...types.structured, ...types.wellKnown];
export const primitiveTypes = types.primitive;
export const structuredTypes = types.structured;
export const wellKnownTypes = types.wellKnown;
