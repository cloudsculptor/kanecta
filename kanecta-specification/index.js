'use strict';

const { version } = require('./package.json');

module.exports = {
  version,
  type:     require(`./${version}/file-specs/type.json`),
  items:    require(`./${version}/file-specs/items.json`),
  metadata: require(`./${version}/file-specs/metadata.json`),
  meta:     require(`./${version}/file-specs/meta.json`),
};
