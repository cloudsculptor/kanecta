import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MergePreview } from '../../../api/workingSets';
import { MergePullRequestDialog } from '../MergePullRequestDialog';

const mockGetMergePreview = vi.fn();
const mockMergeBranch = vi.fn().mockResolvedValue({ ok: true, merged: 2 });

vi.mock('../../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api')>();
  return {
    ...actual,
    api: {
      workingSets: {
        getMergePreview: (...a: unknown[]) => mockGetMergePreview(...a),
        mergeBranch: (...a: unknown[]) => mockMergeBranch(...a),
      },
    },
  };
});

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function preview(overrides: Partial<MergePreview> = {}): MergePreview {
  return {
    branch: 'feature/x',
    adds: 1,
    edits: 1,
    deletes: 0,
    conflicts: [],
    blastRadius: [],
    ...overrides,
  };
}

function renderDialog(overrides?: Partial<React.ComponentProps<typeof MergePullRequestDialog>>) {
  const onMerged = vi.fn();
  const onClose = vi.fn();
  render(
    <MergePullRequestDialog
      open
      onClose={onClose}
      workingSetName="kanecta-internal"
      branch="feature/x"
      diff={{ adds: 1, edits: 1, deletes: 0 }}
      onMerged={onMerged}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
  return { onMerged, onClose };
}

describe('MergePullRequestDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMergeBranch.mockResolvedValue({ ok: true, merged: 2 });
  });

  it('merges directly when the preview is clean (no strategy)', async () => {
    const user = userEvent.setup();
    mockGetMergePreview.mockResolvedValue(preview());
    const { onMerged } = renderDialog();

    const merge = await screen.findByRole('button', { name: 'Merge into main' });
    // Enabled once the (clean) preview resolves.
    await waitFor(() => expect(merge).toBeEnabled());

    await user.click(merge);
    expect(mockMergeBranch).toHaveBeenCalledWith('kanecta-internal', 'feature/x', undefined);
    expect(onMerged).toHaveBeenCalled();
  });

  it('requires a strategy before merging when there are conflicts', async () => {
    const user = userEvent.setup();
    mockGetMergePreview.mockResolvedValue(
      preview({ conflicts: [{ id: 'aaaaaaaa-1111-2222-3333-444444444444', kind: 'edit-edit' }] }),
    );
    renderDialog();

    // Conflicts are surfaced.
    expect(await screen.findByTestId('merge-conflicts')).toBeInTheDocument();

    // Merge is blocked until a strategy is chosen.
    const merge = screen.getByRole('button', { name: 'Merge into main' });
    expect(merge).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Keep this branch's version/ }));
    expect(merge).toBeEnabled();

    await user.click(merge);
    expect(mockMergeBranch).toHaveBeenCalledWith('kanecta-internal', 'feature/x', {
      strategy: 'theirs',
    });
  });

  it('renders the item-level changes list when the preview carries detail', async () => {
    mockGetMergePreview.mockResolvedValue(
      preview({
        detail: {
          adds: [
            {
              id: 'aaaaaaaa-1111-2222-3333-444444444444',
              after: { id: 'aaaaaaaa-1111-2222-3333-444444444444', value: 'Fundraising ideas', type: 'note' },
            },
          ],
          edits: [
            {
              id: 'bbbbbbbb-1111-2222-3333-444444444444',
              before: { id: 'bbbbbbbb-1111-2222-3333-444444444444', value: 'AGM agenda', type: 'note' },
              after: { id: 'bbbbbbbb-1111-2222-3333-444444444444', value: 'AGM agenda 2026', type: 'note' },
            },
          ],
          deletes: [],
        },
      }),
    );
    renderDialog();

    const list = await screen.findByTestId('branch-diff-list');
    expect(list).toHaveTextContent('Fundraising ideas');
    expect(list).toHaveTextContent('AGM agenda 2026');
  });

  it('tolerates a preview without detail (older server)', async () => {
    mockGetMergePreview.mockResolvedValue(preview());
    renderDialog();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Merge into main' })).toBeEnabled(),
    );
    expect(screen.queryByTestId('branch-diff-list')).not.toBeInTheDocument();
  });

  it('surfaces the blast radius of deletions', async () => {
    mockGetMergePreview.mockResolvedValue(
      preview({
        deletes: 1,
        blastRadius: [
          {
            id: 'bbbbbbbb-1111-2222-3333-444444444444',
            referencedBy: [{ id: 'cccccccc-1111-2222-3333-444444444444', via: 'parent' }],
          },
        ],
      }),
    );
    renderDialog({ diff: { adds: 0, edits: 0, deletes: 1 } });

    const blast = await screen.findByTestId('merge-blast-radius');
    expect(blast).toHaveTextContent('bbbbbbbb');
    expect(blast).toHaveTextContent(/referenced by 1 item/);
  });
});
