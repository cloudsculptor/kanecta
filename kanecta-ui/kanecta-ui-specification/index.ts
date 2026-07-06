import pkg from './package.json' with { type: 'json' };

export const version: string = pkg.version;

/** Matches a valid published component package name: @kanecta/component-<slug> */
export const COMPONENT_NAME_PATTERN: RegExp = /^@kanecta\/component-[a-z][a-z0-9-]*$/;

/** Matches a valid component package folder name: kanecta-component-<slug> */
export const COMPONENT_FOLDER_PATTERN: RegExp = /^kanecta-component-[a-z][a-z0-9-]*$/;

/** Minimum required peer dependency version ranges. */
export const REQUIRED_PEER_DEPS: Record<string, string> = { react: '>=19' };

/** Regex that matches forbidden caret-pinned version ranges (^x.y.z). */
export const FORBIDDEN_DEP_RANGES: RegExp = /^\^/;
