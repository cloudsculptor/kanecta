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
import { useWorkspaceStore } from '../../store/workspace';
import { api } from '../../api';
import type { WorkingSet } from '../../api';
import './DatastoreSwitcher.scss';

interface AvatarProps {
  label: string;
  colour: string;
  size?: 'sm' | 'md';
}

function DatastoreAvatar({ label, colour, size = 'md' }: AvatarProps) {
  return (
    <span
      className={`DatastoreSwitcher__avatar DatastoreSwitcher__avatar--${size}`}
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

export function DatastoreSwitcher() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { workspaces, activeWorkspaceId } = useWorkspaceStore();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const queryClient = useQueryClient();

  const open = Boolean(anchor);

  const { data: wsSummary, isError: wsError } = useQuery({
    queryKey: ['working-sets'],
    queryFn: () => api.workingSets.list(),
    retry: 1,
    staleTime: 10_000,
  });

  const switchBranchMutation = useMutation({
    mutationFn: ({ workspaceName, branch }: { workspaceName: string; branch: string }) =>
      api.workingSets.switchBranch(workspaceName, branch),
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
        className={`DatastoreSwitcher${showError ? ' DatastoreSwitcher--error' : ''}`}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label="Switch datastore"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {showError
          ? <ErrorOutlinedIcon className="DatastoreSwitcher__error-icon" />
          : <DatastoreAvatar label={displayName} colour={active?.colour ?? '#888'} size="sm" />
        }
        <span className="DatastoreSwitcher__name">
          {showError ? 'Unavailable' : displayName}
        </span>
        <ArrowDropDownIcon className="DatastoreSwitcher__arrow" />
      </button>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { className: 'DatastoreSwitcher__panel' } }}
      >

        {/* ── Active Working Set ── */}
        <div className="DatastoreSwitcher__section-header">Active working set</div>
        <div className="DatastoreSwitcher__working-set">
          <div className="DatastoreSwitcher__ws-name">{displayName}</div>

          {hasRemote && (
            <button className="DatastoreSwitcher__ws-row DatastoreSwitcher__ws-row--clickable">
              <CloudOutlinedIcon className="DatastoreSwitcher__ws-icon" />
              <span className="DatastoreSwitcher__ws-label">
                <strong>origin</strong>
                <span className="DatastoreSwitcher__ws-sub">
                  {originDesc ?? `${displayName} — Remote`}
                </span>
              </span>
              <ChevronRightIcon className="DatastoreSwitcher__ws-chevron" />
            </button>
          )}

          <button className={`DatastoreSwitcher__ws-row DatastoreSwitcher__ws-row--clickable${hasRemote ? ' DatastoreSwitcher__ws-row--bordered' : ''}`}>
            <StorageIcon className="DatastoreSwitcher__ws-icon" />
            <span className="DatastoreSwitcher__ws-label">
              <strong>local</strong>
              <span className="DatastoreSwitcher__ws-sub">
                {activeWs ? `${localDescription(activeWs)} — Filesystem + SQLite` : 'Filesystem + SQLite'}
              </span>
            </span>
            <ChevronRightIcon className="DatastoreSwitcher__ws-chevron" />
          </button>

          <div className="DatastoreSwitcher__branches-heading">Branches</div>
          <ul className="DatastoreSwitcher__branches DatastoreSwitcher__branches--inset">
            {(activeWs?.branches ?? []).map((b) => (
              <li key={b.name}>
                <button
                  className={`DatastoreSwitcher__branch${b.active ? ' DatastoreSwitcher__branch--active' : ''}`}
                  onClick={() => {
                    if (!b.active && activeWs) {
                      switchBranchMutation.mutate({ workspaceName: activeWs.name, branch: b.name });
                    }
                  }}
                >
                  <span className="DatastoreSwitcher__branch-glyph">⎇</span>
                  <span className="DatastoreSwitcher__branch-name">{b.name}</span>
                  {b.active && <CheckIcon className="DatastoreSwitcher__branch-check" />}
                </button>
              </li>
            ))}
            <li>
              <button className="DatastoreSwitcher__branch DatastoreSwitcher__branch--add">
                <AddIcon className="DatastoreSwitcher__branch-add-icon" />
                <span className="DatastoreSwitcher__branch-name">New branch</span>
              </button>
            </li>
          </ul>

          {hasRemote && (
            <div className="DatastoreSwitcher__ws-status">
              <div className="DatastoreSwitcher__ws-status-row">
                <span className="DatastoreSwitcher__ws-status-arrow">↑</span>
                <span className="DatastoreSwitcher__ws-stat DatastoreSwitcher__ws-stat--add DatastoreSwitcher__ws-stat--zero">
                  +0 add
                </span>
                <span className="DatastoreSwitcher__ws-stat DatastoreSwitcher__ws-stat--edit DatastoreSwitcher__ws-stat--zero">
                  ±0 edit
                </span>
                <span className="DatastoreSwitcher__ws-stat DatastoreSwitcher__ws-stat--del DatastoreSwitcher__ws-stat--zero">
                  −0 del
                </span>
              </div>
            </div>
          )}
        </div>

        <Divider />

        {/* ── Available Working Sets ── */}
        <div className="DatastoreSwitcher__section-header">Available working sets</div>
        <ul className="DatastoreSwitcher__available-list">
          {availableWs.map((ws) => {
            const remDesc = remoteDescription(ws);
            const wsHasRemote = Boolean(Object.keys(ws.remotes ?? {}).length > 0);
            const activeBranch = ws.branches.find((b) => b.active)?.name ?? ws.branch;
            return (
              <li key={ws.name} className="DatastoreSwitcher__available-item">
                <div className="DatastoreSwitcher__available-item-header">
                  <span className="DatastoreSwitcher__available-item-name">{toDisplayName(ws.name)}</span>
                  <button className="DatastoreSwitcher__make-active-btn">Make active</button>
                </div>
                {wsHasRemote && (
                  <div className="DatastoreSwitcher__available-row">
                    <CloudOutlinedIcon className="DatastoreSwitcher__available-icon" />
                    <span className="DatastoreSwitcher__available-name">origin</span>
                    <span className="DatastoreSwitcher__available-sub">{remDesc ?? 'Remote'}</span>
                  </div>
                )}
                <div className="DatastoreSwitcher__available-row">
                  <StorageIcon className="DatastoreSwitcher__available-icon" />
                  <span className="DatastoreSwitcher__available-name">{localDescription(ws)}</span>
                  <span className="DatastoreSwitcher__available-sub">⎇ {activeBranch}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="DatastoreSwitcher__available-add">
          <button className="DatastoreSwitcher__available-add-btn">
            <AddIcon />
            <span>Add working set</span>
          </button>
        </div>

        {/* ── Actions ── */}
        <div className="DatastoreSwitcher__actions">
          <button className="DatastoreSwitcher__action-btn">
            <AltRouteIcon />
            <span>Create Pull Request</span>
          </button>
        </div>

      </Popover>
    </>
  );
}
