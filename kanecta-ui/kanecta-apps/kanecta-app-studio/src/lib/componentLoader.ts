import type { ComponentType } from 'react';

/**
 * Soft-coded component loading (host side).
 *
 * A Connector app is a package of `component` items: its `kanecta.manifest.json`
 * lists the components it ships, each pointing at a `kanecta.item.json`. At
 * runtime the app builds a *registry* mapping each component's stable id → the
 * item metadata + the React component to render, and drives its UI from that
 * registry rather than a hardcoded switch.
 *
 * This module is the PURE core of that: `buildComponentRegistry` takes the
 * manifest, the component items, and the modules that expose each component, and
 * returns the registry. HOW items/modules are obtained is injected by the host —
 * bundled behind the loader today (Vite `import.meta.glob`), loaded from the
 * device component store later — so the same registry logic is host-agnostic and
 * fully testable. See the UI spec, "Runtime Resolution and the Device Store".
 */

/** The subset of a component's `kanecta.item.json` the loader uses. */
export interface ComponentItemJson {
  item: { id: string; type: string; value: string };
  meta?: { files?: { body?: string } };
  payload?: { description?: string; props?: unknown[] };
}

/** One entry in an app's `kanecta.manifest.json`. */
export interface ManifestItem {
  id: string;
  type: string;
  file: string;
}

export interface AppManifest {
  schemaVersion: string;
  package: string;
  layer: string;
  items: ManifestItem[];
}

/** A component resolved from the manifest + its item + its (host-provided) module. */
export interface LoadedComponent {
  /** Stable component id (the `component` item UUID). */
  id: string;
  /** Display name (`item.value`). */
  name: string;
  item: ComponentItemJson;
  Component: ComponentType<Record<string, unknown>>;
}

/**
 * The host state contract for VIEW components (UI spec: "View Components and the
 * Host State Contract"). The host owns per-view state and its persistence; a view
 * receives its state and a way to update it through props, plus the Kanecta data
 * interface it needs. A view MUST NOT touch disk / localStorage / any store.
 */
export interface ViewComponentProps<TState = unknown, TApi = unknown> {
  /** The view's last-persisted state (opaque to the host). Absent on first open. */
  state?: TState | null;
  /** The view calls this when its state changes; the host persists it. */
  onStateChange?: (next: TState) => void;
  /** The Kanecta data interface (API / query client), provided by the host. */
  api?: TApi;
}

/**
 * Build the runtime component registry from an app manifest, the component items
 * it references (`itemsById`), and the modules that expose each component
 * (`componentsById`). Only `component`-typed manifest entries are included.
 * Missing items or modules are reported via `onMissing` and skipped, never thrown
 * — a missing component degrades that one view, it does not break the app.
 */
export function buildComponentRegistry(
  manifest: AppManifest,
  itemsById: Record<string, ComponentItemJson>,
  componentsById: Record<string, ComponentType<Record<string, unknown>>>,
  opts: { onMissing?: (id: string, reason: string) => void } = {},
): Record<string, LoadedComponent> {
  const registry: Record<string, LoadedComponent> = {};
  for (const mi of manifest.items) {
    if (mi.type !== 'component') continue;
    const item = itemsById[mi.id];
    if (!item) {
      opts.onMissing?.(mi.id, 'no component item resolved');
      continue;
    }
    const Component = componentsById[mi.id];
    if (!Component) {
      opts.onMissing?.(mi.id, 'no component module resolved');
      continue;
    }
    registry[mi.id] = { id: mi.id, name: item.item.value, item, Component };
  }
  return registry;
}

/**
 * Index a set of `kanecta.item.json` objects by their component id. Convenience
 * for turning the raw results of a bundled glob (or a store read) into the
 * `itemsById` map `buildComponentRegistry` expects.
 */
export function indexItemsById(items: ComponentItemJson[]): Record<string, ComponentItemJson> {
  const out: Record<string, ComponentItemJson> = {};
  for (const it of items) {
    if (it?.item?.id && it.item.type === 'component') out[it.item.id] = it;
  }
  return out;
}
