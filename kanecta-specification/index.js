'use strict';

const { version } = require('./package.json');
const types = require(`./${version}/types/built-in-types.json`);

module.exports = {
  version,
  item:             require(`./${version}/file-specs/item.json`),
  types,
  allTypes:         [...types.primitive, ...types.structured, ...types.wellKnown],
  primitiveTypes:   types.primitive,
  structuredTypes:  types.structured,
  wellKnownTypes:   types.wellKnown,
};
