import { describe, it, expect, vi } from 'vitest';
import type { ComponentType } from 'react';
import {
  buildComponentRegistry,
  indexItemsById,
  type AppManifest,
  type ComponentItemJson,
} from './componentLoader';

const Dummy = (() => null) as ComponentType<Record<string, unknown>>;

function item(id: string, value: string, type = 'component'): ComponentItemJson {
  return { item: { id, type, value }, meta: { files: { body: 'src/index.ts' } }, payload: { props: [] } };
}

const MANIFEST: AppManifest = {
  schemaVersion: '1.4.0',
  package: 'kanecta-app-test',
  layer: 'ui',
  items: [
    { id: 'aaa', type: 'component', file: '../a/kanecta.item.json' },
    { id: 'bbb', type: 'component', file: '../b/kanecta.item.json' },
  ],
};

describe('buildComponentRegistry', () => {
  it('builds an id → { item, Component, name } registry from the manifest', () => {
    const registry = buildComponentRegistry(
      MANIFEST,
      { aaa: item('aaa', 'Tree View'), bbb: item('bbb', 'Table View') },
      { aaa: Dummy, bbb: Dummy },
    );
    expect(Object.keys(registry).sort()).toEqual(['aaa', 'bbb']);
    expect(registry.aaa.name).toBe('Tree View');
    expect(registry.aaa.Component).toBe(Dummy);
    expect(registry.bbb.item.item.value).toBe('Table View');
  });

  it('skips (does not throw) a manifest entry with no resolved item, and reports it', () => {
    const onMissing = vi.fn();
    const registry = buildComponentRegistry(
      MANIFEST,
      { aaa: item('aaa', 'Tree View') }, // bbb item missing
      { aaa: Dummy, bbb: Dummy },
      { onMissing },
    );
    expect(Object.keys(registry)).toEqual(['aaa']);
    expect(onMissing).toHaveBeenCalledWith('bbb', 'no component item resolved');
  });

  it('skips (does not throw) a manifest entry with no resolved module, and reports it', () => {
    const onMissing = vi.fn();
    const registry = buildComponentRegistry(
      MANIFEST,
      { aaa: item('aaa', 'Tree View'), bbb: item('bbb', 'Table View') },
      { aaa: Dummy }, // bbb module missing
      { onMissing },
    );
    expect(Object.keys(registry)).toEqual(['aaa']);
    expect(onMissing).toHaveBeenCalledWith('bbb', 'no component module resolved');
  });

  it('ignores non-component manifest entries', () => {
    const manifest: AppManifest = { ...MANIFEST, items: [{ id: 'x', type: 'view', file: 'x' }] };
    const registry = buildComponentRegistry(manifest, { x: item('x', 'X', 'view') }, { x: Dummy });
    expect(registry).toEqual({});
  });
});

describe('indexItemsById', () => {
  it('indexes component items by id and skips non-component/malformed', () => {
    const idx = indexItemsById([
      item('aaa', 'A'),
      item('bbb', 'B', 'view'), // not a component
      { item: { id: '', type: 'component', value: 'bad' } },
    ]);
    expect(Object.keys(idx)).toEqual(['aaa']);
  });
});
