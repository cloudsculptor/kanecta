'use strict';

// Test helpers for pointing the MCP server at temp datastores via KANECTA_CONFIG.
// The MCP no longer reads KANECTA_DATASTORE/KANECTA_DATASTORES — every consumer
// resolves the active working set from config.json located by KANECTA_CONFIG.

const os = require('os');
const path = require('path');
const fs = require('fs');

// Write a temp config.json with the given working sets and point KANECTA_CONFIG at it.
function useConfig(workingSets, defaultWorkingSet) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-mcp-cfg-'));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ specVersion: '1.4.0', defaultWorkingSet, workingSets }),
  );
  process.env.KANECTA_CONFIG = dir;
  return dir;
}

// Convenience: a single default working set pointing at one datastore root.
function singleConfig(datastoreRoot, name = 'default') {
  return useConfig({ [name]: { local: datastoreRoot, defaultBranch: 'main' } }, name);
}

function clearConfigEnv() {
  delete process.env.KANECTA_CONFIG;
  delete process.env.KANECTA_WORKING_SET;
  delete process.env.KANECTA_BRANCH;
}

module.exports = { useConfig, singleConfig, clearConfigEnv };
