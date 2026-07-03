import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import type { BranchDiffSummary, MergeStrategy } from '../../api/workingSets';
import './MergePullRequestDialog.scss';

interface MergePullRequestDialogProps {
  open: boolean;
  onClose: () => void;
  workingSetName: string;
  /** The branch being merged into main. */
  branch: string;
  /** Change counts for `branch` vs its upstream, shown as the merge preview. */
  diff: BranchDiffSummary;
  /** Called once the branch has been merged into main. */
  onMerged: () => void;
}

const shortId = (id: string) => id.slice(0, 8);

const CONFLICT_LABEL: Record<string, string> = {
  'edit-edit': 'edited on both the branch and main',
  'delete-edit': 'deleted here, but edited on main',
  'add-delete': 'kept here, but deleted on main',
};

export function MergePullRequestDialog({
  open,
  onClose,
  workingSetName,
  branch,
  diff,
  onMerged,
}: MergePullRequestDialogProps) {
  const [strategy, setStrategy] = useState<'' | MergeStrategy>('');

  // Load the conflict / blast-radius preview when the dialog opens. It applies
  // nothing — it's the "review before you merge" step.
  const preview = useQuery({
    queryKey: ['merge-preview', workingSetName, branch],
    queryFn: () => api.workingSets.getMergePreview(workingSetName, branch),
    enabled: open,
    staleTime: 0,
  });

  const mergeMutation = useMutation({
    mutationFn: () =>
      api.workingSets.mergeBranch(workingSetName, branch, strategy ? { strategy } : undefined),
    onSuccess: () => onMerged(),
  });

  function handleClose() {
    if (mergeMutation.isPending) return;
    mergeMutation.reset();
    setStrategy('');
    onClose();
  }

  const conflicts = preview.data?.conflicts ?? [];
  const blastRadius = preview.data?.blastRadius ?? [];
  const hasConflicts = conflicts.length > 0;

  const total = diff.adds + diff.edits + diff.deletes;
  const canMerge =
    total > 0 &&
    !mergeMutation.isPending &&
    !preview.isLoading &&
    (!hasConflicts || strategy !== '');

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Create pull request</DialogTitle>
      <DialogContent className="MergePullRequestDialog__content">
        <p className="MergePullRequestDialog__summary">
          Merge <strong>{branch}</strong> into <strong>main</strong>.
        </p>

        <ul className="MergePullRequestDialog__stats">
          <li className="MergePullRequestDialog__stat MergePullRequestDialog__stat--add">
            +{diff.adds} added
          </li>
          <li className="MergePullRequestDialog__stat MergePullRequestDialog__stat--edit">
            ±{diff.edits} edited
          </li>
          <li className="MergePullRequestDialog__stat MergePullRequestDialog__stat--del">
            −{diff.deletes} deleted
          </li>
        </ul>

        {total === 0 && (
          <p className="MergePullRequestDialog__empty">
            This branch has no changes to merge.
          </p>
        )}

        {preview.isLoading && (
          <p className="MergePullRequestDialog__loading">
            <CircularProgress size={14} />
            <span>Checking for conflicts…</span>
          </p>
        )}

        {hasConflicts && (
          <div className="MergePullRequestDialog__section" data-testid="merge-conflicts">
            <p className="MergePullRequestDialog__section-title MergePullRequestDialog__section-title--warn">
              {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} — main changed since this branch forked
            </p>
            <ul className="MergePullRequestDialog__conflicts">
              {conflicts.map((c) => (
                <li key={c.id} className="MergePullRequestDialog__conflict">
                  <code>{shortId(c.id)}</code> {CONFLICT_LABEL[c.kind] ?? c.kind}
                </li>
              ))}
            </ul>

            <FormControl className="MergePullRequestDialog__strategy">
              <FormLabel id="merge-strategy-label">How should conflicts resolve?</FormLabel>
              <RadioGroup
                aria-labelledby="merge-strategy-label"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
              >
                <FormControlLabel
                  value="theirs"
                  control={<Radio size="small" />}
                  label="Keep this branch's version (overwrite main)"
                />
                <FormControlLabel
                  value="ours"
                  control={<Radio size="small" />}
                  label="Keep main's version (drop the conflicting changes)"
                />
              </RadioGroup>
            </FormControl>
          </div>
        )}

        {blastRadius.length > 0 && (
          <div className="MergePullRequestDialog__section" data-testid="merge-blast-radius">
            <p className="MergePullRequestDialog__section-title MergePullRequestDialog__section-title--warn">
              {blastRadius.length} deleted item{blastRadius.length === 1 ? ' is' : 's are'} still referenced on main
            </p>
            <ul className="MergePullRequestDialog__blast">
              {blastRadius.map((b) => (
                <li key={b.id} className="MergePullRequestDialog__blast-item">
                  <code>{shortId(b.id)}</code> — referenced by {b.referencedBy.length}{' '}
                  item{b.referencedBy.length === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="MergePullRequestDialog__note">
          The changes are applied to main and the branch is removed. The working
          set switches to main.
        </p>

        {(mergeMutation.isError || preview.isError) && (
          <p className="MergePullRequestDialog__error" role="alert">
            {((mergeMutation.error ?? preview.error) as Error).message}
          </p>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={mergeMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => mergeMutation.mutate()}
          disabled={!canMerge}
        >
          {mergeMutation.isPending ? 'Merging…' : 'Merge into main'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
