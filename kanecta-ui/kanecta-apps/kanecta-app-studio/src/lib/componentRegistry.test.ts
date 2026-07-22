import { describe, it, expect } from 'vitest';
import manifest from '../../kanecta.manifest.json';
import { softComponentRegistry, softComponentRegistryMisses, viewTypeToComponentId } from './componentRegistry';

// This exercises the REAL Vite glue (import.meta.glob over the actual
// component packages), not a fixture — it's the integration test that the
// 33 manifest ids really do resolve to a bundled item + entry module.
// `component-core` is registered in the manifest but ships no renderable
// component (just types + a data-source context/hooks — see its src/index.ts)
// — it's the one expected, permanent miss. Anything else missing here is a
// real regression in the glob/export-name correlation.
const EXPECTED_MISSING_IDS = ['c60898f7-10b2-4066-8303-d22a07718106']; // component-core

describe('componentRegistry (Vite glue)', () => {
  it('resolves every component-typed manifest entry except the known non-view utility package (component-core)', () => {
    const componentEntries = manifest.items.filter((i) => i.type === 'component');
    expect(componentEntries.length).toBeGreaterThan(0);
    const missedIds = softComponentRegistryMisses.map((m) => m.split(':')[0]);
    expect(missedIds.sort()).toEqual(EXPECTED_MISSING_IDS.sort());
    const expectedResolved = componentEntries
      .map((i) => i.id)
      .filter((id) => !EXPECTED_MISSING_IDS.includes(id));
    expect(Object.keys(softComponentRegistry).sort()).toEqual(expectedResolved.sort());
  });

  it('keys each registry entry by the component item id, with a matching name and a component function', () => {
    for (const item of manifest.items.filter((i) => i.type === 'component')) {
      if (EXPECTED_MISSING_IDS.includes(item.id)) continue;
      const entry = softComponentRegistry[item.id];
      expect(entry, `missing registry entry for ${item.id}`).toBeDefined();
      expect(entry.id).toBe(item.id);
      expect(entry.item.item.id).toBe(item.id);
      expect(typeof entry.Component).toBe('function');
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it('resolves known Studio viewTypes to their soft component id by the <viewType>-view convention', () => {
    expect(viewTypeToComponentId('list')).toBe(
      manifest.items.find((i) => i.file.includes('kanecta-component-list-view'))?.id,
    );
    expect(viewTypeToComponentId('tree')).toBe(
      manifest.items.find((i) => i.file.includes('kanecta-component-tree-view'))?.id,
    );
  });

  it('resolves the mission-control override (no "-view" suffix on that package)', () => {
    expect(viewTypeToComponentId('mission-control')).toBe(
      manifest.items.find((i) => i.file.includes('kanecta-component-mission-control/'))?.id,
    );
  });

  it('returns undefined for viewTypes with no registered soft component (not yet migrated)', () => {
    expect(viewTypeToComponentId('digest')).toBeUndefined();
    expect(viewTypeToComponentId('settings')).toBeUndefined();
    expect(viewTypeToComponentId('pipelines')).toBeUndefined();
    expect(viewTypeToComponentId('frames')).toBeUndefined();
    expect(viewTypeToComponentId('not-a-real-view-type')).toBeUndefined();
  });
});
