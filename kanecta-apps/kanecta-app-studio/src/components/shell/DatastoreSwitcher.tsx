import { useEffect, useState } from 'react';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DifferenceOutlinedIcon from '@mui/icons-material/DifferenceOutlined';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import HistoryIcon from '@mui/icons-material/History';
import CallMergeIcon from '@mui/icons-material/CallMerge';
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
const MOCK_REMOTE = { name: 'origin', description: 'DigitalOcean Postgres' };
const MOCK_AHEAD = 0;
const MOCK_BEHIND = 3;
const MOCK_BRANCHES = [
  { name: 'richardsempire', active: true },
  { name: 'linz-onboarding', active: false },
  { name: 'experiment/ai-tagging', active: false },
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

        {/* ── Working Set ── */}
        <div className="DatastoreSwitcher__section-header">Working Set</div>
        <div className="DatastoreSwitcher__working-set">
          <button className="DatastoreSwitcher__ws-row DatastoreSwitcher__ws-row--remote">
            <CloudOutlinedIcon className="DatastoreSwitcher__ws-icon" />
            <span className="DatastoreSwitcher__ws-label">
              <strong>{MOCK_REMOTE.name}</strong>
              <span className="DatastoreSwitcher__ws-sub">{MOCK_REMOTE.description}</span>
            </span>
            <ChevronRightIcon className="DatastoreSwitcher__ws-chevron" />
          </button>
          <div className="DatastoreSwitcher__ws-divider" />
          <div className="DatastoreSwitcher__ws-row DatastoreSwitcher__ws-row--branch">
            <span className="DatastoreSwitcher__branch-glyph">⎇</span>
            <span className="DatastoreSwitcher__ws-label">
              {MOCK_BRANCHES.find((b) => b.active)?.name ?? '—'}
            </span>
          </div>
          <div className="DatastoreSwitcher__ws-status">
            <span className="DatastoreSwitcher__ws-ahead">↑ {MOCK_AHEAD} to push</span>
            <span className="DatastoreSwitcher__ws-sep">·</span>
            <span className="DatastoreSwitcher__ws-behind">↓ {MOCK_BEHIND} to pull</span>
          </div>
        </div>

        <Divider />

        {/* ── Local Branches ── */}
        <div className="DatastoreSwitcher__section-header">Local Branches</div>
        <ul className="DatastoreSwitcher__branches">
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

        <Divider />

        {/* ── Actions ── */}
        <div className="DatastoreSwitcher__actions">
          <button className="DatastoreSwitcher__action-btn">
            <ArrowDownwardIcon />
            <span>Pull</span>
          </button>
          <button className="DatastoreSwitcher__action-btn">
            <ArrowUpwardIcon />
            <span>Push</span>
          </button>
          <button className="DatastoreSwitcher__action-btn">
            <DifferenceOutlinedIcon />
            <span>Diff</span>
          </button>
          <button className="DatastoreSwitcher__action-btn">
            <MergeTypeIcon />
            <span>Merge</span>
          </button>
          <button className="DatastoreSwitcher__action-btn">
            <HistoryIcon />
            <span>Log</span>
          </button>
          <button className="DatastoreSwitcher__action-btn">
            <CallMergeIcon />
            <span>PR</span>
          </button>
        </div>

      </Popover>
    </>
  );
}
