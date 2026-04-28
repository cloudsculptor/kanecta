'use strict';

const { randomUUID } = require('crypto');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToShardPath(uuid) {
  return uuid.replace(/-/g, '').match(/.{2}/g).join('/');
}

function isValidUuid(uuid) {
  return typeof uuid === 'string' && UUID_REGEX.test(uuid);
}

function generateUuid() {
  return randomUUID();
}

module.exports = { uuidToShardPath, isValidUuid, generateUuid };
