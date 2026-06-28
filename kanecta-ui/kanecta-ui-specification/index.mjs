import pkg from './package.json' assert { type: 'json' };

export const version = pkg.version;
export const COMPONENT_NAME_PATTERN = /^@kanecta\/component-[a-z][a-z0-9-]*$/;
export const COMPONENT_FOLDER_PATTERN = /^kanecta-component-[a-z][a-z0-9-]*$/;
export const REQUIRED_PEER_DEPS = { react: '>=19' };
export const FORBIDDEN_DEP_RANGES = /^\^/;
