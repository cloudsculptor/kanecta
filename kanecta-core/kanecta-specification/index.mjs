import { createRequire } from 'module';
import types from './1.4.0/built-in-types/built-in-types.json' with { type: 'json' };
import itemSpec from './1.4.0/core-file-specs/item.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };

const require = createRequire(import.meta.url);

export const version = pkg.version;
export const item = itemSpec;
export { types };
export const allTypes = [...types.primitive, ...types.structured, ...types.wellKnown];
export const primitiveTypes = types.primitive;
export const structuredTypes = types.structured;
export const wellKnownTypes = types.wellKnown;

// Core manifest of built-in type ITEMS (full item.json docs, fixed UUIDs).
export const builtInTypeManifest = require(`./${pkg.version}/built-in-types/kanecta.manifest.json`);
export const builtInTypeItems = builtInTypeManifest.items.map(
  (entry) => require(`./${pkg.version}/${entry.file}`),
);
