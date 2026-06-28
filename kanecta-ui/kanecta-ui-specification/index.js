'use strict';

const { version } = require('./package.json');

module.exports = {
  version,
  COMPONENT_NAME_PATTERN: /^@kanecta\/component-[a-z][a-z0-9-]*$/,
  COMPONENT_FOLDER_PATTERN: /^kanecta-component-[a-z][a-z0-9-]*$/,
  REQUIRED_PEER_DEPS: {
    react: '>=19',
  },
  FORBIDDEN_DEP_RANGES: /^\^/,
};
