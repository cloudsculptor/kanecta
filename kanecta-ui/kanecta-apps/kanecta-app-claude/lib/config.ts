import fs from 'fs';
import path from 'path';
import os from 'os';

export const CONFIG_PATH = path.join(os.homedir(), '.kanecta-config.json');
export const KANECTA_DIR = path.join(os.homedir(), '.kanecta');
export const LOCATION_FILE = path.join(KANECTA_DIR, 'location.txt');

export function readConfig(): any {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export function writeConfig(cfg: any): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

export function expandHome(p: string): string {
  return p ? p.replace(/^~/, os.homedir()) : p;
}

export function getDatastorePath(): string {
  const cfg = readConfig();
  if (cfg && cfg.datastorePath) return expandHome(cfg.datastorePath);
  try {
    const loc = fs.readFileSync(LOCATION_FILE, 'utf8').trim();
    if (loc) return expandHome(loc);
  } catch {}
  return KANECTA_DIR;
}

export function isConfigured(): boolean {
  const cfg = readConfig();
  return !!(cfg && cfg.wizardCompleted);
}
