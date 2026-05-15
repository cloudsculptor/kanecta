import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../workspace';

describe('useWorkspaceStore', () => {
  const PRIMARY_ID = 'primary';

  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: PRIMARY_ID,
          name: 'Primary',
          apiUrl: '/api',
          colour: '#1976d2',
          pollIntervalMs: 5000,
        },
      ],
      activeWorkspaceId: PRIMARY_ID,
    });
  });

  it('starts with one primary workspace', () => {
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(PRIMARY_ID);
  });

  it('addWorkspace adds and returns an id', () => {
    const id = useWorkspaceStore.getState().addWorkspace({
      name: 'Claude 2',
      apiUrl: 'http://localhost:3001',
      colour: '#e65100',
      pollIntervalMs: 3000,
    });
    expect(id).toBeTruthy();
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id);
    expect(ws?.name).toBe('Claude 2');
  });

  it('updateWorkspace updates a field', () => {
    useWorkspaceStore.getState().updateWorkspace(PRIMARY_ID, { name: 'Updated' });
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === PRIMARY_ID);
    expect(ws?.name).toBe('Updated');
  });

  it('removeWorkspace removes the workspace', () => {
    const id = useWorkspaceStore.getState().addWorkspace({
      name: 'To remove',
      apiUrl: 'http://localhost:3002',
      colour: '#ccc',
      pollIntervalMs: 5000,
    });
    useWorkspaceStore.getState().removeWorkspace(id);
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === id)).toBeUndefined();
  });

  it('removeWorkspace resets activeWorkspaceId when removing active', () => {
    const id = useWorkspaceStore.getState().addWorkspace({
      name: 'Second',
      apiUrl: 'http://localhost:3002',
      colour: '#ccc',
      pollIntervalMs: 5000,
    });
    useWorkspaceStore.getState().setActiveWorkspace(id);
    useWorkspaceStore.getState().removeWorkspace(id);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(PRIMARY_ID);
  });

  it('getActiveWorkspace returns the active workspace', () => {
    const ws = useWorkspaceStore.getState().getActiveWorkspace();
    expect(ws?.id).toBe(PRIMARY_ID);
  });

  it('getApi returns an API client object', () => {
    const api = useWorkspaceStore.getState().getApi();
    expect(api).toHaveProperty('items');
    expect(api).toHaveProperty('aliases');
    expect(api).toHaveProperty('tree');
  });
});
