'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const appConfig = require('../src/appConfig');

// Each test points KANECTA_CONFIG at a throwaway directory and restores the
// environment afterwards so the resolver's discovery is fully isolated.
const ENV_KEYS = ['KANECTA_CONFIG', 'KANECTA_WORKING_SET', 'KANECTA_BRANCH', 'XDG_CONFIG_HOME'];
let saved;

function tmpConfigDir(config, { env, state } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-cfg-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  if (env) fs.writeFileSync(path.join(dir, '.env'), env);
  if (state) fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  process.env.KANECTA_CONFIG = dir;
  return dir;
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const BASE = {
  specVersion: '1.4.0',
  defaultWorkingSet: 'main',
  workingSets: {
    main: { local: '/tmp/ws-main', defaultBranch: 'main' },
    feat: { local: { type: 'filesystem', path: '/tmp/ws-feat' }, defaultBranch: 'develop' },
  },
};

describe('getConfigPath', () => {
  test('KANECTA_CONFIG as a directory appends config.json', () => {
    const dir = tmpConfigDir(BASE);
    expect(appConfig.getConfigPath()).toBe(path.join(dir, 'config.json'));
  });

  test('KANECTA_CONFIG pointing at a .json file is used directly', () => {
    const dir = tmpConfigDir(BASE);
    process.env.KANECTA_CONFIG = path.join(dir, 'config.json');
    expect(appConfig.getConfigPath()).toBe(path.join(dir, 'config.json'));
  });

  test('falls back to XDG default on Linux when unset', () => {
    if (process.platform !== 'linux') return;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg';
    expect(appConfig.getConfigPath()).toBe('/tmp/xdg/kanecta/config.json');
  });
});

describe('readAppConfig', () => {
  test('resolves $VAR values from a sibling .env', () => {
    tmpConfigDir(
      {
        specVersion: '1.4.0',
        defaultWorkingSet: 'pg',
        workingSets: { pg: { local: '/tmp/pg', remotes: { origin: { type: 'postgres', password: '$DB_PW' } } } },
      },
      { env: 'DB_PW=s3cret\n' },
    );
    const cfg = appConfig.readAppConfig();
    expect(cfg.workingSets.pg.remotes.origin.password).toBe('s3cret');
  });

  test('normalizes legacy workspaces/defaultWorkspace keys', () => {
    tmpConfigDir({
      specVersion: '1.4.0',
      defaultWorkspace: 'main',
      workspaces: { main: { local: '/tmp/a' } },
    });
    const cfg = appConfig.readAppConfig();
    expect(Object.keys(cfg.workingSets)).toEqual(['main']);
    expect(cfg.defaultWorkingSet).toBe('main');
  });

  test('returns null when config is absent', () => {
    process.env.KANECTA_CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    expect(appConfig.readAppConfig()).toBeNull();
  });
});

describe('resolveWorkingSet', () => {
  test('uses defaultWorkingSet when nothing overrides', () => {
    tmpConfigDir(BASE);
    expect(appConfig.resolveWorkingSet().name).toBe('main');
  });

  test('explicit name beats env beats state beats default', () => {
    tmpConfigDir(BASE, { state: { activeWorkingSet: 'feat' } });
    expect(appConfig.resolveWorkingSet().name).toBe('feat'); // state over default
    process.env.KANECTA_WORKING_SET = 'main';
    expect(appConfig.resolveWorkingSet().name).toBe('main'); // env over state
    expect(appConfig.resolveWorkingSet('feat').name).toBe('feat'); // explicit over env
  });

  test('throws a listing error for an unknown working set', () => {
    tmpConfigDir(BASE);
    expect(() => appConfig.resolveWorkingSet('nope')).toThrow(/known working sets: main, feat/);
  });

  test('picks the sole working set when there is exactly one and no default', () => {
    tmpConfigDir({ specVersion: '1.4.0', workingSets: { only: { local: '/tmp/o' } } });
    expect(appConfig.resolveWorkingSet().name).toBe('only');
  });
});

describe('resolveBranch', () => {
  test('falls through override → env → state → defaultBranch → main', () => {
    tmpConfigDir(BASE, { state: { activeBranch: { feat: 'hotfix' } } });
    expect(appConfig.resolveBranch('feat', 'arg')).toBe('arg');        // explicit
    process.env.KANECTA_BRANCH = 'envbr';
    expect(appConfig.resolveBranch('feat')).toBe('envbr');             // env
    delete process.env.KANECTA_BRANCH;
    expect(appConfig.resolveBranch('feat')).toBe('hotfix');            // state
    expect(appConfig.resolveBranch('main')).toBe('main');             // defaultBranch
    expect(appConfig.resolveBranch('unknown-ws')).toBe('main');        // fallback
  });
});

describe('state helpers', () => {
  test('setActiveWorkingSet / setActiveBranch persist to state.json', () => {
    const dir = tmpConfigDir(BASE);
    appConfig.setActiveWorkingSet('feat');
    appConfig.setActiveBranch('feat', 'hotfix');
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    expect(state).toEqual({ activeWorkingSet: 'feat', activeBranch: { feat: 'hotfix' } });
  });
});

describe('workingSetLocalPath', () => {
  test('handles string and typed-filesystem local shapes', () => {
    expect(appConfig.workingSetLocalPath({ local: '/tmp/a' })).toBe('/tmp/a');
    expect(appConfig.workingSetLocalPath({ local: { type: 'filesystem', path: '/tmp/b' } })).toBe('/tmp/b');
    expect(appConfig.workingSetLocalPath({ datastore: '/tmp/legacy' })).toBe('/tmp/legacy');
    expect(appConfig.workingSetLocalPath({})).toBeNull();
  });
});

describe('migrateConfigShape', () => {
  test('renames legacy keys and branch→defaultBranch', () => {
    const out = appConfig.migrateConfigShape({
      specVersion: '1.4.0',
      defaultWorkspace: 'main',
      workspaces: {
        main: { local: '/tmp/a', branch: 'develop' },
        other: { local: '/tmp/b' },
      },
    });
    expect(out.workspaces).toBeUndefined();
    expect(out.defaultWorkspace).toBeUndefined();
    expect(out.defaultWorkingSet).toBe('main');
    expect(Object.keys(out.workingSets)).toEqual(['main', 'other']);
    expect(out.workingSets.main.defaultBranch).toBe('develop');
    expect(out.workingSets.main.branch).toBeUndefined();
  });

  test('maps legacy "default" key and supplies specVersion', () => {
    const out = appConfig.migrateConfigShape({
      default: 'only',
      workspaces: { only: { local: '/tmp/o' } },
    });
    expect(out.defaultWorkingSet).toBe('only');
    expect(out.specVersion).toBe('1.4.0');
  });

  test('is idempotent on an already-migrated config', () => {
    const current = {
      specVersion: '1.4.0',
      defaultWorkingSet: 'main',
      workingSets: { main: { local: '/tmp/a', defaultBranch: 'main' } },
    };
    expect(appConfig.migrateConfigShape(current)).toEqual(current);
  });

  test('does not clobber an existing defaultBranch', () => {
    const out = appConfig.migrateConfigShape({
      workspaces: { main: { local: '/tmp/a', branch: 'x', defaultBranch: 'y' } },
    });
    expect(out.workingSets.main.defaultBranch).toBe('y');
  });
});
