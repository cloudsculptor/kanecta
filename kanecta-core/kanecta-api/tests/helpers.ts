// Point the API at a temp datastore via KANECTA_CONFIG. The API no longer reads
// KANECTA_DATASTORE — it resolves the active working set from config.json.

import os from 'os';
import path from 'path';
import fs from 'fs';

export function useConfig(datastoreRoot, name = 'default') {
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

export function clearConfigEnv() {
  delete process.env.KANECTA_CONFIG;
  delete process.env.KANECTA_WORKING_SET;
  delete process.env.KANECTA_BRANCH;
}
