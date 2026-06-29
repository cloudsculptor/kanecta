'use strict';

// Point the API at a temp datastore via KANECTA_CONFIG. The API no longer reads
// KANECTA_DATASTORE — it resolves the active working set from config.json.

const os = require('os');
const path = require('path');
const fs = require('fs');

function useConfig(datastoreRoot, name = 'default') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-cfg-'));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      specVersion: '1.4.0',
      defaultWorkingSet: name,
      workingSets: { [name]: { local: datastoreRoot, defaultBranch: 'main' } },
    }),
  );
  process.env.KANECTA_CONFIG = dir;
  return dir;
}

function clearConfigEnv() {
  delete process.env.KANECTA_CONFIG;
  delete process.env.KANECTA_WORKING_SET;
  delete process.env.KANECTA_BRANCH;
}

module.exports = { useConfig, clearConfigEnv };
