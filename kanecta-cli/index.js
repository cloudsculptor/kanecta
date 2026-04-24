#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const datastoreRoot = path.resolve(__dirname, '../../kanecta-private-datastore');
const config = JSON.parse(fs.readFileSync(path.join(datastoreRoot, '.kanecta', 'config', 'config.json'), 'utf8'));
const { id: rootId, levels: maxLevels } = config.defaultView;

function uuidToPath(uuid) {
  return uuid.replace(/-/g, '').match(/.{2}/g).join('/');
}

function loadAllItems() {
  const dataDir = path.join(datastoreRoot, '.kanecta', 'data');
  const items = {};
  const byParent = {};

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'metadata.json') {
        const item = JSON.parse(fs.readFileSync(full, 'utf8'));
        items[item.id] = item;
        const key = item.parent_id || '__root__';
        if (!byParent[key]) byParent[key] = [];
        byParent[key].push(item);
      }
    }
  }

  walk(dataDir);

  for (const key of Object.keys(byParent)) {
    byParent[key].sort((a, b) => a.sort_order - b.sort_order);
  }

  return { items, byParent };
}

function buildText(rootId, items, byParent, maxLevels) {
  const lines = [];

  function traverse(id, depth) {
    if (depth > maxLevels) return;
    const item = items[id];
    if (!item) return;

    lines.push(`${'  '.repeat(depth)}${item.value}`);

    for (const child of byParent[id] || []) {
      traverse(child.id, depth + 1);
    }
  }

  traverse(rootId, 0);
  return lines.join('\n') + '\n';
}

const { items, byParent } = loadAllItems();
const output = buildText(rootId, items, byParent, maxLevels);

const outputPath = path.join(datastoreRoot, 'kanecta.txt');
fs.writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath}`);
