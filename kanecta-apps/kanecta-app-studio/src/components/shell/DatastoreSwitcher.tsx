import { useEffect, useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '../../store/workspace';
import { api } from '../../api';
import './DatastoreSwitcher.scss';

function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() ?? p;
}

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

// Hardcoded mock data — UI only, wired up later
const MOCK_ACTIVE_NAME = 'richardsempire main';
const MOCK_REMOTE = { name: 'origin', description: 'DigitalOcean Postgres' };
const MOCK_LOCAL = { name: 'local', description: 'richardsempire', branch: 'main' };
const MOCK_TO_PUSH = { add: 2, edit: 1, del: 0 };
const MOCK_AVAILABLE = [
  { id: 'ws-work',     name: 'Work shared',       remote: 'work',     remoteDesc: 'Work shared server',     local: 'shared-knowledge', branch: 'main' },
  { id: 'ws-personal', name: 'Personal projects', remote: 'personal', remoteDesc: 'Personal cloud storage', local: 'side-project',     branch: 'experiment/ai-tagging' },
];
const MOCK_BRANCHES = [
  { name: 'main', active: true },
  { name: 'feature/ai-tagging', active: false },
  { name: 'experiment/graph-viz', active: false },
];

export function DatastoreSwitcher() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { workspaces, activeWorkspaceId, updateWorkspace } = useWorkspaceStore();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  const open = Boolean(anchor);

  const { data: activeConfig, isError: activeConfigError } = useQuery({
    queryKey: ['config', activeWorkspaceId],
    queryFn: () => api.config.get(),
    retry: 1,
  });

  useEffect(() => {
    if (activeConfig?.datastorePath) {
      const folderName = basename(activeConfig.datastorePath);
      updateWorkspace(activeWorkspaceId, {
        datastorePath: activeConfig.datastorePath,
        name: folderName,
      });
    }
  }, [activeConfig?.datastorePath, activeWorkspaceId, updateWorkspace]);

  const resolvedPath = activeConfig?.datastorePath ?? active?.datastorePath;
  const datastoreName = resolvedPath ? basename(resolvedPath) : (active?.name ?? null);
  const showError = activeConfigError && !active?.datastorePath;

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
          : <DatastoreAvatar label={datastoreName ?? '?'} colour={active?.colour ?? '#888'} size="sm" />
        }
        <span className="DatastoreSwitcher__name">
          {showError ? 'Unavailable' : (datastoreName ?? '…')}
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
          <div className="DatastoreSwitcher__ws-name">{MOCK_ACTIVE_NAME}</div>
          <button className="DatastoreSwitcher__ws-row DatastoreSwitcher__ws-row--clickable">
            <CloudOutlinedIcon className="DatastoreSwitcher__ws-icon" />
            <span className="DatastoreSwitcher__ws-label">
              <strong>{MOCK_REMOTE.name}</strong>
              <span className="DatastoreSwitcher__ws-sub">{MOCK_REMOTE.description}</span>
            </span>
            <ChevronRightIcon className="DatastoreSwitcher__ws-chevron" />
          </button>
          <div className="DatastoreSwitcher__ws-divider" />
          <button className="DatastoreSwitcher__ws-row DatastoreSwitcher__ws-row--clickable">
            <StorageIcon className="DatastoreSwitcher__ws-icon" />
            <span className="DatastoreSwitcher__ws-label">
              <strong>{MOCK_LOCAL.name}</strong>
              <span className="DatastoreSwitcher__ws-sub">{MOCK_LOCAL.description}</span>
            </span>
            <ChevronRightIcon className="DatastoreSwitcher__ws-chevron" />
          </button>
          <div className="DatastoreSwitcher__branches-heading">Branches</div>
          <ul className="DatastoreSwitcher__branches DatastoreSwitcher__branches--inset">
            {MOCK_BRANCHES.map((b) => (
              <li key={b.name}>
                <button className={`DatastoreSwitcher__branch${b.active ? ' DatastoreSwitcher__branch--active' : ''}`}>
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
          <div className="DatastoreSwitcher__ws-status">
            <div className="DatastoreSwitcher__ws-status-row">
              <span className="DatastoreSwitcher__ws-status-arrow">↑</span>
              <span className={`DatastoreSwitcher__ws-stat DatastoreSwitcher__ws-stat--add${MOCK_TO_PUSH.add === 0 ? ' DatastoreSwitcher__ws-stat--zero' : ''}`}>
                +{MOCK_TO_PUSH.add} add
              </span>
              <span className={`DatastoreSwitcher__ws-stat DatastoreSwitcher__ws-stat--edit${MOCK_TO_PUSH.edit === 0 ? ' DatastoreSwitcher__ws-stat--zero' : ''}`}>
                ±{MOCK_TO_PUSH.edit} edit
              </span>
              <span className={`DatastoreSwitcher__ws-stat DatastoreSwitcher__ws-stat--del${MOCK_TO_PUSH.del === 0 ? ' DatastoreSwitcher__ws-stat--zero' : ''}`}>
                −{MOCK_TO_PUSH.del} del
              </span>
            </div>
          </div>
        </div>

        <Divider />

        {/* ── Available Working Sets ── */}
        <div className="DatastoreSwitcher__section-header">Available working sets</div>
        <ul className="DatastoreSwitcher__available-list">
          {MOCK_AVAILABLE.map((ws) => (
            <li key={ws.id} className="DatastoreSwitcher__available-item">
              <div className="DatastoreSwitcher__available-item-header">
                <span className="DatastoreSwitcher__available-item-name">{ws.name}</span>
                <button className="DatastoreSwitcher__make-active-btn">Make active</button>
              </div>
              <div className="DatastoreSwitcher__available-row">
                <CloudOutlinedIcon className="DatastoreSwitcher__available-icon" />
                <span className="DatastoreSwitcher__available-name">{ws.remote}</span>
                <span className="DatastoreSwitcher__available-sub">{ws.remoteDesc}</span>
              </div>
              <div className="DatastoreSwitcher__available-row">
                <StorageIcon className="DatastoreSwitcher__available-icon" />
                <span className="DatastoreSwitcher__available-name">{ws.local}</span>
                <span className="DatastoreSwitcher__available-sub">⎇ {ws.branch}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="DatastoreSwitcher__available-add">
          <button className="DatastoreSwitcher__available-add-btn">
            <AddIcon />
            <span>Add working set</span>
          </button>
        </div>

        <Divider />

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
