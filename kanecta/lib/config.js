'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.kanecta-config.json');
const KANECTA_DIR = path.join(os.homedir(), '.kanecta');
const LOCATION_FILE = path.join(KANECTA_DIR, 'location.txt');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function expandHome(p) {
  return p ? p.replace(/^~/, os.homedir()) : p;
}

function getDatastorePath() {
  const cfg = readConfig();
  if (cfg && cfg.datastorePath) return expandHome(cfg.datastorePath);
  try {
    const loc = fs.readFileSync(LOCATION_FILE, 'utf8').trim();
    if (loc) return expandHome(loc);
  } catch {}
  return KANECTA_DIR;
}

function isConfigured() {
  const cfg = readConfig();
  return !!(cfg && cfg.wizardCompleted);
}

module.exports = {
  readConfig,
  writeConfig,
  getDatastorePath,
  isConfigured,
  expandHome,
  CONFIG_PATH,
  KANECTA_DIR,
  LOCATION_FILE,
};
