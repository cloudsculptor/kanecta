'use strict';

const { createApiClient, KanectaApiClient } = require('@kanecta/api-client');

// Backward-compatible alias: createClient is the same as createApiClient
function createClient(options = {}) {
  return createApiClient(options);
}

module.exports = {
  // Primary API
  createApiClient,
  KanectaApiClient,
  // Legacy alias
  createClient,
};
