import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NodeContent } from '../components/NodeContent';
import { TreeViewContext } from '../context';
import type { KanectaItem } from '../types';

const TARGET_ID = '11111111-2222-4333-8444-555555555555';

function item(partial: Partial<KanectaItem>): KanectaItem {
  return {
    id: 'x',
    value: '',
    type: 'text',
    sortOrder: 0,
    tags: [],
    createdAt: null,
    modifiedAt: null,
    childCount: 0,
    ...partial,
  } as KanectaItem;
}

function symlink(targetId: string = TARGET_ID): KanectaItem {
  return item({ id: 'link-1', type: 'symlink', value: targetId });
}

function renderWithProviders(
  ui: ReactNode,
  { get }: { get?: (id: string) => Promise<KanectaItem> } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ctx = {
    api: { items: { get: get ?? vi.fn() } },
    workspaceKey: 'test',
    vscodeAvailable: false,
    focusedItemId: null,
    todoMode: false,
    onFocusItem: vi.fn(),
    onSelectItem: vi.fn(),
    onOpenOverlay: vi.fn(),
  } as any;
  return render(
    <QueryClientProvider client={queryClient}>
      <TreeViewContext.Provider value={ctx}>{ui}</TreeViewContext.Provider>
    </QueryClientProvider>,
  );
}

describe('NodeContent symlink rendering', () => {
  it('renders the target value with a green bullet when the target is already loaded', () => {
    const target = item({ id: TARGET_ID, value: 'the real item' });
    const resolveId = (id: string) => (id === TARGET_ID ? target : undefined);
    const { container } = renderWithProviders(
      <NodeContent item={symlink()} resolveId={resolveId} />,
    );
    expect(screen.getByText('the real item')).toBeTruthy();
    const bullet = container.querySelector('.NodeContent-symlink-bullet');
    expect(bullet).toBeTruthy();
    expect(bullet!.classList.contains('is-broken')).toBe(false);
  });

  it('fetches an unloaded target via api.items.get and renders it', async () => {
    const target = item({ id: TARGET_ID, value: 'fetched item' });
    const get = vi.fn(async (id: string) => {
      expect(id).toBe(TARGET_ID);
      return target;
    });
    renderWithProviders(<NodeContent item={symlink()} />, { get });
    await waitFor(() => expect(screen.getByText('fetched item')).toBeTruthy());
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('dispatches a table target to the host renderTable seam (universal rendering)', () => {
    const target = item({ id: TARGET_ID, value: 'My table', type: 'table' });
    const resolveId = (id: string) => (id === TARGET_ID ? target : undefined);
    const renderTable = vi.fn((t: KanectaItem) => <div>grid for {t.value}</div>);
    renderWithProviders(
      <NodeContent item={symlink()} resolveId={resolveId} renderTable={renderTable} />,
    );
    expect(renderTable).toHaveBeenCalledWith(target);
    expect(screen.getByText('grid for My table')).toBeTruthy();
  });

  it('renders an image target as an image, not text', () => {
    const target = item({
      id: TARGET_ID,
      value: 'https://example.com/pic.png',
      type: 'image',
    });
    const resolveId = (id: string) => (id === TARGET_ID ? target : undefined);
    const { container } = renderWithProviders(
      <NodeContent item={symlink()} resolveId={resolveId} />,
    );
    const img = container.querySelector('img.NodeContent-image');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://example.com/pic.png');
  });

  it('shows a broken (red) bullet and the dangling UUID when the target does not exist', async () => {
    const get = vi.fn(async () => {
      throw new Error('not found');
    });
    const { container } = renderWithProviders(<NodeContent item={symlink()} />, { get });
    await waitFor(() =>
      expect(
        container.querySelector('.NodeContent-symlink-bullet.is-broken'),
      ).toBeTruthy(),
    );
    expect(screen.getByText(TARGET_ID)).toBeTruthy();
  });

  it('falls back to plain text when the value is not a UUID', () => {
    const { container } = renderWithProviders(
      <NodeContent item={symlink('not-a-uuid')} />,
    );
    expect(screen.getByText('not-a-uuid')).toBeTruthy();
    expect(container.querySelector('.NodeContent-symlink')).toBeNull();
  });

  it('navigates to the target when the bullet is clicked', async () => {
    const target = item({ id: TARGET_ID, value: 'destination' });
    const resolveId = (id: string) => (id === TARGET_ID ? target : undefined);
    const onNavigate = vi.fn();
    const { container } = renderWithProviders(
      <NodeContent item={symlink()} resolveId={resolveId} onNavigate={onNavigate} />,
    );
    await userEvent.click(container.querySelector('.NodeContent-symlink-bullet')!);
    expect(onNavigate).toHaveBeenCalledWith(TARGET_ID);
  });

  it('renders a symlink chain through to the final target, and breaks cycles', () => {
    // a -> b -> c(text): two hops, well within MAX_SYMLINK_DEPTH.
    const c = item({ id: '33333333-2222-4333-8444-555555555555', value: 'end of chain' });
    const b = item({
      id: '22222222-2222-4333-8444-555555555555',
      type: 'symlink',
      value: c.id,
    });
    const chain = new Map([[b.id, b], [c.id, c]]);
    const resolveId = (id: string) => chain.get(id);
    renderWithProviders(<NodeContent item={symlink(b.id)} resolveId={resolveId} />);
    expect(screen.getByText('end of chain')).toBeTruthy();

    // A self-cycle must terminate in a broken bullet instead of recursing forever.
    const loop = item({ id: TARGET_ID, type: 'symlink', value: TARGET_ID });
    const { container } = renderWithProviders(
      <NodeContent item={symlink()} resolveId={(id) => (id === TARGET_ID ? loop : undefined)} />,
    );
    expect(container.querySelector('.NodeContent-symlink-bullet.is-broken')).toBeTruthy();
  });
});
