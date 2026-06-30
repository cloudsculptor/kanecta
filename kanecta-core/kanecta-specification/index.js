'use strict';

const { version } = require('./package.json');
const types = require(`./${version}/built-in-types/built-in-types.json`);

// The core manifest of built-in type ITEMS (full item.json docs, fixed UUIDs).
// The bootstrapper seeds these so every built-in type is a resolvable item.
const builtInTypeManifest = require(`./${version}/built-in-types/kanecta.manifest.json`);
const builtInTypeItems = builtInTypeManifest.items.map(
  (entry) => require(`./${version}/${entry.file}`),
);

module.exports = {
  version,
  item:             require(`./${version}/core-file-specs/item.json`),
  types,
  allTypes:         [...types.primitive, ...types.structured, ...types.wellKnown],
  primitiveTypes:   types.primitive,
  structuredTypes:  types.structured,
  wellKnownTypes:   types.wellKnown,
  builtInTypeManifest,
  builtInTypeItems,
};
