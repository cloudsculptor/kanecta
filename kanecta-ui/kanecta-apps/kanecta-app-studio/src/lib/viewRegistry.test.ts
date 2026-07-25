import { describe, it, expect } from 'vitest';
import { VIEW_REGISTRY, SOFT_COMPONENTS_ENABLED, resolveSoftView } from './viewRegistry';
import { softComponentRegistry, viewTypeToComponentId } from './componentRegistry';

describe('VIEW_REGISTRY (unchanged uuid-keyed metadata)', () => {
  it('still exposes the existing uuid -> ViewMeta map', () => {
    expect(Object.keys(VIEW_REGISTRY).length).toBeGreaterThan(0);
    for (const [uuid, meta] of Object.entries(VIEW_REGISTRY)) {
      expect(meta.uuid).toBe(uuid);
    }
  });
});

describe('SOFT_COMPONENTS_ENABLED', () => {
  it('defaults to false (flag OFF unless VITE_SOFT_COMPONENTS=true) — matches the default build behaviour', () => {
    // The test runner does not set VITE_SOFT_COMPONENTS, so this asserts the
    // real default the app ships with: soft components are opt-in only.
    expect(import.meta.env.VITE_SOFT_COMPONENTS).not.toBe('true');
    expect(SOFT_COMPONENTS_ENABLED).toBe(false);
  });
});

describe('resolveSoftView', () => {
  it('resolves a registered viewType (list) to the same Component the registry holds', () => {
    const id = viewTypeToComponentId('list');
    expect(id).toBeDefined();
    expect(resolveSoftView('list')).toBe(softComponentRegistry[id as string].Component);
  });

  it('returns undefined for an unregistered viewType (e.g. settings — no soft component yet)', () => {
    expect(resolveSoftView('settings')).toBeUndefined();
  });

  it('returns undefined for a completely unknown viewType', () => {
    expect(resolveSoftView('does-not-exist')).toBeUndefined();
  });
});
