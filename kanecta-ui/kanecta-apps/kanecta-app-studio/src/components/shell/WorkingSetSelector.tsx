import { useState } from 'react';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import StorageIcon from '@mui/icons-material/Storage';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import Divider from '@mui/material/Divider';
import Popover from '@mui/material/Popover';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkingSetStore } from '../../store/workingSet';
import { api } from '../../api';
import type { WorkingSet } from '../../api';
import './WorkingSetSelector.scss';

interface AvatarProps {
  label: string;
  colour: string;
  size?: 'sm' | 'md';
}

function WorkingSetAvatar({ label, colour, size = 'md' }: AvatarProps) {
  return (
    <span
      className={`WorkingSetSelector__avatar WorkingSetSelector__avatar--${size}`}
      style={{ background: colour }}
      aria-hidden
    >
      {label[0]?.toUpperCase()}
    </span>
  );
}

function toDisplayName(name: string): string {
  return name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function remoteDescription(ws: WorkingSet): string | null {
  const origin = ws.remotes?.origin;
  if (!origin) return null;
  if (origin.type === 'postgres' && origin.host) {
    return `${origin.host}/${origin.database ?? ''}`;
  }
  return origin.type ?? null;
}

function localDescription(ws: WorkingSet): string {
  if (!ws.local?.path) return 'local';
  const parts = ws.local.path.split('/');
  return parts[parts.length - 1] || ws.local.path;
}

export function WorkingSetSelector() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { workingSets, activeWorkingSetId } = useWorkingSetStore();
  const active = workingSets.find((w) => w.id === activeWorkingSetId);
  const queryClient = useQueryClient();

  const open = Boolean(anchor);

  const { data: wsSummary, isError: wsError } = useQuery({
    queryKey: ['working-sets'],
    queryFn: () => api.workingSets.list(),
    retry: 1,
    staleTime: 10_000,
  });

  const activateMutation = useMutation({
    mutationFn: (name: string) => api.workingSets.activate(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['working-sets'] }),
  });

  const switchBranchMutation = useMutation({
    mutationFn: ({ name, branch }: { name: string; branch: string }) =>
      api.workingSets.switchBranch(name, branch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['working-sets'] }),
  });

  const activeWs = wsSummary?.workingSets.find((w) => w.isActive);
  const availableWs = wsSummary?.workingSets.filter((w) => !w.isActive) ?? [];

  const displayName = activeWs ? toDisplayName(activeWs.name) : (active?.name ?? 'Kanecta');
  const showError = wsError && !activeWs;

  const originDesc = activeWs ? remoteDescription(activeWs) : null;
  const hasRemote  = Boolean(activeWs && Object.keys(activeWs.remotes ?? {}).length > 0);

  return (
    <>
      <button
        className={`WorkingSetSelector${showError ? ' WorkingSetSelector--error' : ''}`}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label="Switch working set"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {showError
          ? <ErrorOutlinedIcon className="WorkingSetSelector__error-icon" />
          : <WorkingSetAvatar label={displayName} colour={active?.colour ?? '#888'} size="sm" />
        }
        <span className="WorkingSetSelector__name">
          {showError ? 'Unavailable' : displayName}
        </span>
        <ArrowDropDownIcon className="WorkingSetSelector__arrow" />
      </button>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { className: 'WorkingSetSelector__panel' } }}
      >

        {/* ── Active Working Set ── */}
        <div className="WorkingSetSelector__section-header">Active working set</div>
        <div className="WorkingSetSelector__working-set">
          <div className="WorkingSetSelector__ws-name">{displayName}</div>

          {hasRemote && (
            <button className="WorkingSetSelector__ws-row WorkingSetSelector__ws-row--clickable">
              <CloudOutlinedIcon className="WorkingSetSelector__ws-icon" />
              <span className="WorkingSetSelector__ws-label">
                <strong>origin</strong>
                <span className="WorkingSetSelector__ws-sub">
                  {originDesc ?? `${displayName} — Remote`}
                </span>
              </span>
              <ChevronRightIcon className="WorkingSetSelector__ws-chevron" />
            </button>
          )}

          <button className={`WorkingSetSelector__ws-row WorkingSetSelector__ws-row--clickable${hasRemote ? ' WorkingSetSelector__ws-row--bordered' : ''}`}>
            <StorageIcon className="WorkingSetSelector__ws-icon" />
            <span className="WorkingSetSelector__ws-label">
              <strong>local</strong>
              <span className="WorkingSetSelector__ws-sub">
                {activeWs ? `${localDescription(activeWs)} — Filesystem + SQLite` : 'Filesystem + SQLite'}
              </span>
            </span>
            <ChevronRightIcon className="WorkingSetSelector__ws-chevron" />
          </button>

          <div className="WorkingSetSelector__branches-heading">Branches</div>
          <ul className="WorkingSetSelector__branches WorkingSetSelector__branches--inset">
            {(activeWs?.branches ?? []).map((b) => (
              <li key={b.name}>
                <button
                  className={`WorkingSetSelector__branch${b.active ? ' WorkingSetSelector__branch--active' : ''}`}
                  onClick={() => {
                    if (!b.active && activeWs) {
                      switchBranchMutation.mutate({ name: activeWs.name, branch: b.name });
                    }
                  }}
                >
                  <span className="WorkingSetSelector__branch-glyph">⎇</span>
                  <span className="WorkingSetSelector__branch-name">{b.name}</span>
                  {b.active && <CheckIcon className="WorkingSetSelector__branch-check" />}
                </button>
              </li>
            ))}
            <li>
              <button className="WorkingSetSelector__branch WorkingSetSelector__branch--add">
                <AddIcon className="WorkingSetSelector__branch-add-icon" />
                <span className="WorkingSetSelector__branch-name">New branch</span>
              </button>
            </li>
          </ul>

          {hasRemote && (
            <div className="WorkingSetSelector__ws-status">
              <div className="WorkingSetSelector__ws-status-row">
                <span className="WorkingSetSelector__ws-status-arrow">↑</span>
                <span className="WorkingSetSelector__ws-stat WorkingSetSelector__ws-stat--add WorkingSetSelector__ws-stat--zero">
                  +0 add
                </span>
                <span className="WorkingSetSelector__ws-stat WorkingSetSelector__ws-stat--edit WorkingSetSelector__ws-stat--zero">
                  ±0 edit
                </span>
                <span className="WorkingSetSelector__ws-stat WorkingSetSelector__ws-stat--del WorkingSetSelector__ws-stat--zero">
                  −0 del
                </span>
              </div>
            </div>
          )}
        </div>

        <Divider />

        {/* ── Available Working Sets ── */}
        <div className="WorkingSetSelector__section-header">Available working sets</div>
        <ul className="WorkingSetSelector__available-list">
          {availableWs.map((ws) => {
            const remDesc = remoteDescription(ws);
            const wsHasRemote = Boolean(Object.keys(ws.remotes ?? {}).length > 0);
            const activeBranch = ws.branches.find((b) => b.active)?.name ?? ws.branch;
            return (
              <li key={ws.name} className="WorkingSetSelector__available-item">
                <div className="WorkingSetSelector__available-item-header">
                  <span className="WorkingSetSelector__available-item-name">{toDisplayName(ws.name)}</span>
                  <button
                    className="WorkingSetSelector__make-active-btn"
                    onClick={() => activateMutation.mutate(ws.name)}
                    disabled={activateMutation.isPending}
                  >
                    Make active
                  </button>
                </div>
                {wsHasRemote && (
                  <div className="WorkingSetSelector__available-row">
                    <CloudOutlinedIcon className="WorkingSetSelector__available-icon" />
                    <span className="WorkingSetSelector__available-name">origin</span>
                    <span className="WorkingSetSelector__available-sub">{remDesc ?? 'Remote'}</span>
                  </div>
                )}
                <div className="WorkingSetSelector__available-row">
                  <StorageIcon className="WorkingSetSelector__available-icon" />
                  <span className="WorkingSetSelector__available-name">{localDescription(ws)}</span>
                  <span className="WorkingSetSelector__available-sub">⎇ {activeBranch}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="WorkingSetSelector__available-add">
          <button className="WorkingSetSelector__available-add-btn">
            <AddIcon />
            <span>Add working set</span>
          </button>
        </div>

        {/* ── Actions ── */}
        <div className="WorkingSetSelector__actions">
          <button className="WorkingSetSelector__action-btn">
            <AltRouteIcon />
            <span>Create Pull Request</span>
          </button>
        </div>

      </Popover>
    </>
  );
}
