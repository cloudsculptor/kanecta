const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

function uuidToPath(uuid) {
  return uuid.replace(/-/g, '').match(/.{2}/g).join('/');
}

function resolveDatastoreRoot() {
  return process.env.KANECTA_DATASTORE
    ? path.resolve(process.env.KANECTA_DATASTORE)
    : path.resolve(__dirname, '../../kanecta-datastore-sample');
}

function loadItem(datastoreRoot, id) {
  const metaPath = path.join(
    datastoreRoot,
    '.kanecta',
    'data',
    uuidToPath(id),
    'metadata.json'
  );
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

function buildByParent(datastoreRoot) {
  const dataDir = path.join(datastoreRoot, '.kanecta', 'data');
  const byParent = {};

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'metadata.json') {
        const item = JSON.parse(fs.readFileSync(full, 'utf8'));
        const key = item.parentId || '__root__';
        if (!byParent[key]) byParent[key] = [];
        byParent[key].push(item);
      }
    }
  }

  walk(dataDir);

  for (const key of Object.keys(byParent)) {
    byParent[key].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return byParent;
}

function buildTree(item, byParent, levelsRemaining) {
  const node = { ...item };
  if (levelsRemaining > 0) {
    node.children = (byParent[item.id] || []).map((child) =>
      buildTree(child, byParent, levelsRemaining - 1)
    );
  }
  return node;
}

app.get('/items/:id', (req, res) => {
  const { id } = req.params;
  const { levels } = req.query;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid UUID format' });
  }

  const datastoreRoot = resolveDatastoreRoot();
  const item = loadItem(datastoreRoot, id);

  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }

  if (levels === undefined) {
    return res.json(item);
  }

  const depth = parseInt(levels, 10);
  if (isNaN(depth) || depth < 1) {
    return res.status(400).json({ error: 'levels must be a positive integer' });
  }

  const byParent = buildByParent(datastoreRoot);
  res.json(buildTree(item, byParent, depth - 1));
});

module.exports = app;
