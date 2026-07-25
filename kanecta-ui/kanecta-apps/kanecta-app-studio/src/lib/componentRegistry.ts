import type { ComponentType } from 'react';
import {
  buildComponentRegistry,
  indexItemsById,
  type AppManifest,
  type ComponentItemJson,
  type LoadedComponent,
} from './componentLoader';
import manifestJson from '../../kanecta.manifest.json';

/**
 * Host-side Vite glue for the soft-coded component registry (see
 * `componentLoader.ts` for the pure core). This is the ONE place that reaches
 * for `import.meta.glob` — it bundles every component package's
 * `kanecta.item.json` + entry module and feeds them into
 * `buildComponentRegistry`, keyed by the component's own item id.
 *
 * Bundled-glob today; the device/system component store can replace this
 * module later without touching `componentLoader.ts` or its callers (see
 * "Runtime Resolution and the Device Store" in the UI spec, and the
 * component-store-as-system-datastore backlog note for the longer-term
 * direction).
 */

const manifest = manifestJson as AppManifest;

// import.meta.glob patterns MUST be static string literals for Vite to
// analyze them — no interpolation. `eager: true` bundles every match
// directly (fine here: this is the whole point, we want them all in the
// build), rather than lazy dynamic imports.
const itemJsonModules = import.meta.glob<ComponentItemJson>(
  '../../../../kanecta-components/kanecta-components-react/*/kanecta.item.json',
  { eager: true, import: 'default' },
);
const entryModules = import.meta.glob<Record<string, unknown>>(
  '../../../../kanecta-components/kanecta-components-react/*/src/index.ts',
  { eager: true },
);

const PKG_DIR_RE = /(kanecta-component-[a-z0-9-]+)/;

function packageDir(path: string): string | undefined {
  return PKG_DIR_RE.exec(path)?.[1];
}

/** Component `kanecta.item.json`, keyed by package directory (e.g. `kanecta-component-list-view`). */
const itemsByDir: Record<string, ComponentItemJson> = {};
for (const [path, json] of Object.entries(itemJsonModules)) {
  const dir = packageDir(path);
  if (dir) itemsByDir[dir] = json;
}

const itemsById = indexItemsById(Object.values(itemsByDir));

/**
 * Component modules keyed by item id. Each package's `src/index.ts` exports
 * its component under a PascalCase name matching its `item.value` with
 * spaces stripped (e.g. `value: "List View"` -> `export { ListView }`) — a
 * convention already followed by all 33 registered packages, verified by
 * inspection rather than enforced here (a package that doesn't follow it
 * degrades gracefully: `buildComponentRegistry` reports it via `onMissing`
 * and skips it, it does not throw).
 */
const componentsById: Record<string, ComponentType<Record<string, unknown>>> = {};
for (const [path, mod] of Object.entries(entryModules)) {
  const dir = packageDir(path);
  const item = dir ? itemsByDir[dir] : undefined;
  if (!item?.item?.id) continue;
  // Matched case-insensitively: `item.value` (e.g. "Ai Instructions View")
  // doesn't always match the acronym casing of the actual export (e.g.
  // `AIInstructionsView`) — the id/module correlation is by directory, this
  // is only picking the right named export off that module.
  const wantName = item.item.value.replace(/\s+/g, '').toLowerCase();
  const namespace = mod as Record<string, unknown>;
  const exportKey = Object.keys(namespace).find((k) => k.toLowerCase() === wantName);
  const Component = exportKey ? namespace[exportKey] : undefined;
  if (typeof Component === 'function') {
    componentsById[item.item.id] = Component as ComponentType<Record<string, unknown>>;
  }
}

/** Reasons any manifest entry failed to resolve — surfaced for diagnostics, not thrown. */
export const softComponentRegistryMisses: string[] = [];

/** id -> { item, Component, name }, built from the manifest + bundled packages. */
export const softComponentRegistry: Record<string, LoadedComponent> = buildComponentRegistry(
  manifest,
  itemsById,
  componentsById,
  {
    onMissing: (id, reason) => {
      softComponentRegistryMisses.push(`${id}: ${reason}`);
    },
  },
);

/**
 * Studio's `ViewType` strings (e.g. `'list'`, `'mission-control'`) predate the
 * component-id-keyed registry and aren't stored on the component item itself.
 * This maps a viewType to its package directory by convention
 * (`<viewType>-view`, with a couple of literal exceptions) purely so the host
 * can look a soft component up by the same string the hardcoded switch uses.
 */
const VIEW_TYPE_DIR_OVERRIDES: Record<string, string> = {
  'mission-control': 'kanecta-component-mission-control',
};

function dirForViewType(viewType: string): string | undefined {
  const override = VIEW_TYPE_DIR_OVERRIDES[viewType];
  if (override) return itemsByDir[override] ? override : undefined;
  const withViewSuffix = `kanecta-component-${viewType}-view`;
  if (itemsByDir[withViewSuffix]) return withViewSuffix;
  const exact = `kanecta-component-${viewType}`;
  if (itemsByDir[exact]) return exact;
  return undefined;
}

/** Resolve a Studio `ViewType` string to its soft-coded component id, if registered. */
export function viewTypeToComponentId(viewType: string): string | undefined {
  const dir = dirForViewType(viewType);
  return dir ? itemsByDir[dir]?.item.id : undefined;
}
