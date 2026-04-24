#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const datastoreRoot = path.resolve(__dirname, '../../kanecta-private-datastore');
const cliConfig = JSON.parse(fs.readFileSync(path.join(datastoreRoot, 'cli', 'config.json'), 'utf8'));
const { id } = cliConfig;

const outputPath = path.join(datastoreRoot, 'kanecta.md');
fs.writeFileSync(outputPath, id);

console.log(`Wrote ${outputPath}`);
