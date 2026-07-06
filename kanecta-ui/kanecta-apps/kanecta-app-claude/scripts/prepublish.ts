#!/usr/bin/env -S node --import tsx
// Run before `npm publish` — updates @kanecta/cli dependency from local file: ref to npm version

import fs from 'fs';
import path from 'path';

const pkgPath = path.join(__dirname, '..', 'package.json');
const cliPkgPath = path.join(__dirname, '..', '..', '..', 'kanecta-cli', 'package.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, 'utf8'));

const cliVersion = cliPkg.version;
if (!cliVersion) {
  console.error('Could not read kanecta-cli version');
  process.exit(1);
}

pkg.dependencies['@kanecta/cli'] = `^${cliVersion}`;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Updated @kanecta/cli dependency to ^${cliVersion}`);
