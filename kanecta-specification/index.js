'use strict';

const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

function loadSpec(name) {
  const file = path.join(__dirname, version, 'file-specs', `${name}.json`);
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  return content ? JSON.parse(content) : null;
}

module.exports = {
  version,
  type:     loadSpec('type'),
  items:    loadSpec('items'),
  metadata: loadSpec('metadata'),
  meta:     loadSpec('meta'),
};
