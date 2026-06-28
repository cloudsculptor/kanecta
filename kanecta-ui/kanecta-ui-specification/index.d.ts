export declare const version: string;

/** Matches a valid published component package name: @kanecta/component-<slug> */
export declare const COMPONENT_NAME_PATTERN: RegExp;

/** Matches a valid component package folder name: kanecta-component-<slug> */
export declare const COMPONENT_FOLDER_PATTERN: RegExp;

/** Minimum required peer dependency version ranges. */
export declare const REQUIRED_PEER_DEPS: Record<string, string>;

/** Regex that matches forbidden caret-pinned version ranges (^x.y.z). */
export declare const FORBIDDEN_DEP_RANGES: RegExp;
