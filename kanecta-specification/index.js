'use strict';

const { version } = require('./package.json');
const types = require(`./${version}/types/primitive.json`);

module.exports = {
  version,
  type:         require(`./${version}/file-specs/type.json`),
  items:        require(`./${version}/file-specs/items.json`),
  metadata:     require(`./${version}/file-specs/metadata.json`),
  functionSpec: require(`./${version}/file-specs/function.json`),
  types,
  allTypes:     [...types.primitive, ...types.structured, ...types.wellKnown],
  primitiveTypes:   types.primitive,
  structuredTypes:  types.structured,
  wellKnownTypes:   types.wellKnown,
};
