import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api';
import type { BranchFill } from '../../api/workingSets';
import './NewBranchDialog.scss';

interface NewBranchDialogProps {
  open: boolean;
  onClose: () => void;
  workingSetName: string;
  /** Existing branch names on this working set (upstream candidates for sparse). */
  branches: string[];
  currentBranch: string;
  /** Called with the new branch name once it is created. */
  onCreated: (branchName: string) => void;
}

export function NewBranchDialog({
  open,
  onClose,
  workingSetName,
  branches,
  currentBranch,
  onCreated,
}: NewBranchDialogProps) {
  const [name, setName] = useState('');
  const [fill, setFill] = useState<BranchFill>('full');
  const [upstream, setUpstream] = useState(currentBranch);

  const trimmed = name.trim();
  const clash = branches.includes(trimmed) || trimmed === 'main';
  const nameError = trimmed && clash ? `Branch "${trimmed}" already exists` : null;

  const createMutation = useMutation({
    mutationFn: () =>
      api.workingSets.createBranch(
        workingSetName,
        trimmed,
        fill === 'sparse' ? { fill: 'sparse', upstream: { branch: upstream } } : { fill: 'full' },
      ),
    onSuccess: () => {
      onCreated(trimmed);
      reset();
    },
  });

  function reset() {
    setName('');
    setFill('full');
    setUpstream(currentBranch);
  }

  function handleClose() {
    if (createMutation.isPending) return;
    createMutation.reset();
    reset();
    onClose();
  }

  const canSubmit = Boolean(trimmed) && !clash && !createMutation.isPending;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>New branch</DialogTitle>
      <DialogContent className="NewBranchDialog__content">
        <TextField
          className="NewBranchDialog__name"
          label="Branch name"
          placeholder="feature/my-change"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={Boolean(nameError)}
          helperText={nameError ?? ' '}
          autoFocus
          fullWidth
          size="small"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) createMutation.mutate();
          }}
        />

        <FormControl className="NewBranchDialog__fill">
          <FormLabel id="new-branch-fill-label">Fill</FormLabel>
          <RadioGroup
            aria-labelledby="new-branch-fill-label"
            value={fill}
            onChange={(e) => setFill(e.target.value as BranchFill)}
          >
            <FormControlLabel
              value="full"
              control={<Radio size="small" />}
              label="Full — a complete copy of the current branch"
            />
            <FormControlLabel
              value="sparse"
              control={<Radio size="small" />}
              label="Sparse — only your changes; the rest reads through an upstream"
            />
          </RadioGroup>
        </FormControl>

        {fill === 'sparse' && (
          <TextField
            className="NewBranchDialog__upstream"
            label="Upstream branch"
            select
            value={upstream}
            onChange={(e) => setUpstream(e.target.value)}
            size="small"
            fullWidth
            helperText="Reads not found locally fall through to this branch"
          >
            {branches.map((b) => (
              <MenuItem key={b} value={b}>
                {b}
              </MenuItem>
            ))}
          </TextField>
        )}

        {createMutation.isError && (
          <p className="NewBranchDialog__error" role="alert">
            {(createMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit}
        >
          {createMutation.isPending ? 'Creating…' : 'Create branch'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
