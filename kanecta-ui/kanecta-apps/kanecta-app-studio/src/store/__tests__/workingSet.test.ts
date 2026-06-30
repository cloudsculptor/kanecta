import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkingSetStore } from '../workingSet';

describe('useWorkingSetStore', () => {
  const PRIMARY_ID = 'primary';

  beforeEach(() => {
    useWorkingSetStore.setState({
      workingSets: [
        {
          id: PRIMARY_ID,
          name: 'Primary',
          apiUrl: '/api',
          colour: '#1976d2',
          pollIntervalMs: 5000,
        },
      ],
      activeWorkingSetId: PRIMARY_ID,
    });
  });

  it('starts with one primary working set', () => {
    expect(useWorkingSetStore.getState().workingSets).toHaveLength(1);
    expect(useWorkingSetStore.getState().activeWorkingSetId).toBe(PRIMARY_ID);
  });

  it('addWorkingSet adds and returns an id', () => {
    const id = useWorkingSetStore.getState().addWorkingSet({
      name: 'Claude 2',
      apiUrl: 'http://localhost:3001',
      colour: '#e65100',
      pollIntervalMs: 3000,
    });
    expect(id).toBeTruthy();
    expect(useWorkingSetStore.getState().workingSets).toHaveLength(2);
    const ws = useWorkingSetStore.getState().workingSets.find((w) => w.id === id);
    expect(ws?.name).toBe('Claude 2');
  });

  it('updateWorkingSet updates a field', () => {
    useWorkingSetStore.getState().updateWorkingSet(PRIMARY_ID, { name: 'Updated' });
    const ws = useWorkingSetStore.getState().workingSets.find((w) => w.id === PRIMARY_ID);
    expect(ws?.name).toBe('Updated');
  });

  it('removeWorkingSet removes the working set', () => {
    const id = useWorkingSetStore.getState().addWorkingSet({
      name: 'To remove',
      apiUrl: 'http://localhost:3002',
      colour: '#ccc',
      pollIntervalMs: 5000,
    });
    useWorkingSetStore.getState().removeWorkingSet(id);
    expect(useWorkingSetStore.getState().workingSets.find((w) => w.id === id)).toBeUndefined();
  });

  it('removeWorkingSet resets activeWorkingSetId when removing active', () => {
    const id = useWorkingSetStore.getState().addWorkingSet({
      name: 'Second',
      apiUrl: 'http://localhost:3002',
      colour: '#ccc',
      pollIntervalMs: 5000,
    });
    useWorkingSetStore.getState().setActiveWorkingSet(id);
    useWorkingSetStore.getState().removeWorkingSet(id);
    expect(useWorkingSetStore.getState().activeWorkingSetId).toBe(PRIMARY_ID);
  });

  it('getActiveWorkingSet returns the active working set', () => {
    const ws = useWorkingSetStore.getState().getActiveWorkingSet();
    expect(ws?.id).toBe(PRIMARY_ID);
  });

  it('getApi returns an API client object', () => {
    const api = useWorkingSetStore.getState().getApi();
    expect(api).toHaveProperty('items');
    expect(api).toHaveProperty('aliases');
    expect(api).toHaveProperty('tree');
  });
});
