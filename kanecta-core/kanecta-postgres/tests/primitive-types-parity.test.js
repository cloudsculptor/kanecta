'use strict';

// Guards against drift: the Postgres adapter keeps a local PRIMITIVE_TYPES set
// (no cross-package dependency), which must stay in sync with the authoritative
// VALID_TYPES exported by @kanecta/filesystem. If a new primitive type is added
// to the filesystem adapter but not here, pg would wrongly warn/throw on it as
// an "unknown type". This is a pure assertion — no database required.

const { PRIMITIVE_TYPES } = require('../src/adapter');
const { VALID_TYPES } = require('@kanecta/filesystem');

test('pg PRIMITIVE_TYPES matches fs VALID_TYPES', () => {
  expect([...PRIMITIVE_TYPES].sort()).toEqual([...VALID_TYPES].sort());
});
