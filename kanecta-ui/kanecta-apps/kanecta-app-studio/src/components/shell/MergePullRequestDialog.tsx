import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api';
import type { BranchDiffSummary } from '../../api/workingSets';
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

export function MergePullRequestDialog({
  open,
  onClose,
  workingSetName,
  branch,
  diff,
  onMerged,
}: MergePullRequestDialogProps) {
  const mergeMutation = useMutation({
    mutationFn: () => api.workingSets.mergeBranch(workingSetName, branch),
    onSuccess: () => onMerged(),
  });

  function handleClose() {
    if (mergeMutation.isPending) return;
    mergeMutation.reset();
    onClose();
  }

  const total = diff.adds + diff.edits + diff.deletes;
  const canMerge = total > 0 && !mergeMutation.isPending;

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

        <p className="MergePullRequestDialog__note">
          The changes are applied to main and the branch is removed. The working
          set switches to main.
        </p>

        {mergeMutation.isError && (
          <p className="MergePullRequestDialog__error" role="alert">
            {(mergeMutation.error as Error).message}
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
