'use strict';

const fs = require('fs/promises');
const path = require('path');
const { uuidToShardPath } = require('./utils');

function itemDir(datastoreRoot, id) {
  return path.join(datastoreRoot, '.kanecta', 'data', uuidToShardPath(id));
}

async function readItem(datastoreRoot, id) {
  const metaPath = path.join(itemDir(datastoreRoot, id), 'metadata.json');
  try {
    return JSON.parse(await fs.readFile(metaPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeItem(datastoreRoot, metadata) {
  const dir = itemDir(datastoreRoot, metadata.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );
}

async function deleteItemDir(datastoreRoot, id) {
  await fs.rm(itemDir(datastoreRoot, id), { recursive: true, force: true });
}

async function readConfig(datastoreRoot) {
  const configPath = path.join(datastoreRoot, '.kanecta', 'config', 'config.json');
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {
    return {};
  }
}

async function walkDataDir(datastoreRoot) {
  const dataDir = path.join(datastoreRoot, '.kanecta', 'data');
  const items = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.name === 'metadata.json') {
          try {
            items.push(JSON.parse(await fs.readFile(full, 'utf8')));
          } catch {
            // skip malformed entries
          }
        }
      })
    );
  }

  await walk(dataDir);
  return items;
}

// --- Backlinks index ---

function backlinksPath(datastoreRoot, targetId) {
  return path.join(datastoreRoot, '.kanecta', 'links', uuidToShardPath(targetId), 'backlinks.json');
}

async function readBacklinks(datastoreRoot, targetId) {
  try {
    return JSON.parse(await fs.readFile(backlinksPath(datastoreRoot, targetId), 'utf8')).backlinks || [];
  } catch {
    return [];
  }
}

async function writeBacklinks(datastoreRoot, targetId, backlinks) {
  const p = backlinksPath(datastoreRoot, targetId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ backlinks }, null, 2), 'utf8');
}

async function addBacklink(datastoreRoot, targetId, sourceId) {
  const backlinks = await readBacklinks(datastoreRoot, targetId);
  if (!backlinks.includes(sourceId)) {
    await writeBacklinks(datastoreRoot, targetId, [...backlinks, sourceId]);
  }
}

async function removeBacklink(datastoreRoot, targetId, sourceId) {
  const backlinks = await readBacklinks(datastoreRoot, targetId);
  const updated = backlinks.filter((id) => id !== sourceId);
  if (updated.length !== backlinks.length) {
    await writeBacklinks(datastoreRoot, targetId, updated);
  }
}

// --- Type index ---

function typeIndexPath(datastoreRoot, typeId) {
  return path.join(datastoreRoot, '.kanecta', 'types', uuidToShardPath(typeId), 'items.json');
}

async function readTypeIndex(datastoreRoot, typeId) {
  try {
    return JSON.parse(await fs.readFile(typeIndexPath(datastoreRoot, typeId), 'utf8')).items || [];
  } catch {
    return [];
  }
}

async function writeTypeIndex(datastoreRoot, typeId, items) {
  const p = typeIndexPath(datastoreRoot, typeId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ items }, null, 2), 'utf8');
}

async function addToTypeIndex(datastoreRoot, typeId, itemId) {
  const items = await readTypeIndex(datastoreRoot, typeId);
  if (!items.includes(itemId)) {
    await writeTypeIndex(datastoreRoot, typeId, [...items, itemId]);
  }
}

async function removeFromTypeIndex(datastoreRoot, typeId, itemId) {
  const items = await readTypeIndex(datastoreRoot, typeId);
  const updated = items.filter((id) => id !== itemId);
  if (updated.length !== items.length) {
    await writeTypeIndex(datastoreRoot, typeId, updated);
  }
}

module.exports = {
  readItem,
  writeItem,
  deleteItemDir,
  readConfig,
  walkDataDir,
  readBacklinks,
  addBacklink,
  removeBacklink,
  addToTypeIndex,
  removeFromTypeIndex,
};
