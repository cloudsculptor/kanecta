/// <reference path="./vendor.d.ts" />
// Export SqliteFsAdapter as FilesystemAdapter so it can be used as a drop-in
// replacement wherever the filesystem adapter is expected.
export {
  SqliteFsAdapter,
  SqliteFsAdapter as FilesystemAdapter,
  UnknownTypeError,
  ROOT_ID,
  TYPES_NODE,
  WELL_KNOWN_TYPES,
  VALID_TYPES,
  VALID_CONFIDENCES,
  VALID_REL_TYPES,
  UUID_RE,
  DEFAULT_LICENSE,
} from './adapter.ts';
