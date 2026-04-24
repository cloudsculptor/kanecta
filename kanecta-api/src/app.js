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
    : path.resolve(__dirname, '../../../kanecta-private-datastore');
}

app.get('/:id', (req, res) => {
  const { id } = req.params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid UUID format' });
  }

  const metaPath = path.join(resolveDatastoreRoot(), '.kanecta', 'data', uuidToPath(id), 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: 'Item not found' });
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    res.json(metadata);
  } catch {
    res.status(500).json({ error: 'Failed to read item' });
  }
});

module.exports = app;
