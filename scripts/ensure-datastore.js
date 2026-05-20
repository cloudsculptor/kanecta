#!/usr/bin/env node
'use strict';

const path = require('path');
const readline = require('readline');
const { Datastore } = require('@kanecta/lib');

const root = process.env.KANECTA_DATASTORE ||
  path.join(process.env.HOME || process.env.USERPROFILE, '.kanecta');

if (Datastore.isDatastore(root)) process.exit(0);

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
