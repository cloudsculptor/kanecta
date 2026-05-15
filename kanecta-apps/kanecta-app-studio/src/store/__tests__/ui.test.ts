import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../ui';

function getStore() {
  return useUiStore.getState();
}

describe('useUiStore', () => {
  beforeEach(() => {
    useUiStore.setState({
      layout: { panels: [{ id: 'default', viewType: 'tree' }], sizes: [100] },
      sidebarState: 'icons',
      rightPanelOpen: false,
      focusedItemId: null,
      filtersByPanel: {},
      sortsByPanel: {},
    });
  });

  it('starts with one tree panel', () => {
    expect(getStore().layout.panels).toHaveLength(1);
    expect(getStore().layout.panels[0].viewType).toBe('tree');
  });

  it('addPanel adds a panel and rebalances sizes', () => {
    getStore().addPanel({ viewType: 'table' });
    expect(getStore().layout.panels).toHaveLength(2);
    expect(getStore().layout.panels[1].viewType).toBe('table');
    expect(getStore().layout.sizes).toHaveLength(2);
    expect(getStore().layout.sizes[0]).toBeCloseTo(50);
  });

  it('removePanel removes a panel and guards against empty', () => {
    getStore().addPanel({ viewType: 'table' });
    const id = getStore().layout.panels[1].id;
    getStore().removePanel(id);
    expect(getStore().layout.panels).toHaveLength(1);
  });

  it('removePanel does not remove the last panel', () => {
    const id = getStore().layout.panels[0].id;
    getStore().removePanel(id);
    expect(getStore().layout.panels).toHaveLength(1);
  });

  it('updatePanel updates viewType', () => {
    const id = getStore().layout.panels[0].id;
    getStore().updatePanel(id, { viewType: 'board' });
    expect(getStore().layout.panels[0].viewType).toBe('board');
  });

  it('setSidebarState toggles sidebar', () => {
    getStore().setSidebarState('expanded');
    expect(getStore().sidebarState).toBe('expanded');
    getStore().setSidebarState('collapsed');
    expect(getStore().sidebarState).toBe('collapsed');
  });

  it('setFocusedItem opens right panel', () => {
    getStore().setFocusedItem('abc-123');
    expect(getStore().focusedItemId).toBe('abc-123');
    expect(getStore().rightPanelOpen).toBe(true);
  });

  it('setFocusedItem with null closes right panel', () => {
    getStore().setFocusedItem('abc-123');
    getStore().setFocusedItem(null);
    expect(getStore().focusedItemId).toBeNull();
    expect(getStore().rightPanelOpen).toBe(false);
  });

  it('setPanelFilter stores filter per panel', () => {
    getStore().setPanelFilter('panel-1', { type: 'fact' });
    expect(getStore().filtersByPanel['panel-1']).toEqual({ type: 'fact' });
  });

  it('setPanelSort stores sort per panel', () => {
    getStore().setPanelSort('panel-1', { field: 'createdAt', direction: 'desc' });
    expect(getStore().sortsByPanel['panel-1']).toEqual({ field: 'createdAt', direction: 'desc' });
  });
});
