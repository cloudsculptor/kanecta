'use strict';

const {
  SqliteFsAdapter,
  UnknownTypeError,
  ROOT_ID,
  TYPES_NODE,
  WELL_KNOWN_TYPES,
  VALID_TYPES,
  VALID_CONFIDENCES,
  VALID_REL_TYPES,
  UUID_RE,
  DEFAULT_LICENSE,
} = require('./adapter');

// Export SqliteFsAdapter as FilesystemAdapter so it can be used as a drop-in
// replacement wherever the filesystem adapter is expected.
module.exports = {
  SqliteFsAdapter,
  FilesystemAdapter: SqliteFsAdapter,
  UnknownTypeError,
  ROOT_ID,
  TYPES_NODE,
  WELL_KNOWN_TYPES,
  VALID_TYPES,
  VALID_CONFIDENCES,
  VALID_REL_TYPES,
  UUID_RE,
  DEFAULT_LICENSE,
};
