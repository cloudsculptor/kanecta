#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Datastore } = require('@kanecta/lib');

const root = process.env.KANECTA_DATASTORE ||
  path.join(process.env.HOME || process.env.USERPROFILE, '.kanecta');

function checkSpecVersion() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'config.json'), 'utf8'));
    const specMd = fs.readFileSync(path.join(__dirname, '../../kanecta-specification/specification.md'), 'utf8');
    const match = specMd.match(/^\*\*Version:\*\*\s*(.+)$/m);
    if (!match) return;
    const specVersion = match[1].trim();
    if (config.specVersion !== specVersion) {
      console.error(`\nError: datastore specVersion (${config.specVersion}) does not match specification (${specVersion})\nUpdate your datastore or check kanecta-specification/specification.md\n`);
      process.exit(1);
    }
  } catch {
    // non-fatal — missing file or parse error, skip silently
  }
}

if (Datastore.isDatastore(root)) {
  checkSpecVersion();
  process.exit(0);
}

if (!process.stdin.isTTY) {
  console.error(`No datastore at ${root}. Set KANECTA_DATASTORE or run: cd kanecta-cli && npm run cli init --owner you@example.com`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question(`No datastore found at ${root}. Create one? [y/N] `, (ans) => {
  if (ans.trim().toLowerCase() !== 'y') {
    rl.close();
    console.log('Aborted.');
    process.exit(1);
  }
  rl.question('Owner email: ', (email) => {
    rl.close();
    email = email.trim();
    if (!email) { console.error('Email required.'); process.exit(1); }
    Datastore.init(root, email);
    console.log(`\nCreated datastore at ${root}\n`);
    process.exit(0);
  });
});
