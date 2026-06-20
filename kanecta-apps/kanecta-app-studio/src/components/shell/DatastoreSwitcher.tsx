import { useEffect, useState } from 'react';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import Divider from '@mui/material/Divider';
import Popover from '@mui/material/Popover';
import { useQuery, useQueries } from '@tanstack/react-query';
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

export function DatastoreSwitcher() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { workspaces, activeWorkspaceId, setActiveWorkspace, updateWorkspace, getApi } = useWorkspaceStore();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  const open = Boolean(anchor);

  const { data: activeConfig, isError: activeConfigError } = useQuery({
    queryKey: ['config', activeWorkspaceId],
    queryFn: () => api.config.get(),
    retry: 1,
  });

  // Cache path and derive display name from the actual datastore folder name
  useEffect(() => {
    if (activeConfig?.datastorePath) {
      const folderName = basename(activeConfig.datastorePath);
      updateWorkspace(activeWorkspaceId, {
        datastorePath: activeConfig.datastorePath,
        name: folderName,
      });
    }
  }, [activeConfig?.datastorePath, activeWorkspaceId, updateWorkspace]);

  const workspaceConfigs = useQueries({
    queries: workspaces.map((w) => ({
      queryKey: ['config', w.id],
      queryFn: () => getApi(w.id).config.get(),
      enabled: open,
      retry: 1,
    })),
  });

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
        aria-haspopup="listbox"
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
        <div className="DatastoreSwitcher__panel-header">Datastores</div>
        <ul className="DatastoreSwitcher__list" role="listbox" aria-label="Datastores">
          {workspaces.map((w, i) => {
            const result = workspaceConfigs[i];
            const path = result?.data?.datastorePath ?? w.datastorePath;
            const pathError = result?.isError && !w.datastorePath;
            const displayName = path ? basename(path) : w.name;
            return (
              <li key={w.id}>
                <button
                  className={`DatastoreSwitcher__option${w.id === activeWorkspaceId ? ' DatastoreSwitcher__option--active' : ''}`}
                  role="option"
                  aria-selected={w.id === activeWorkspaceId}
                  onClick={() => {
                    setActiveWorkspace(w.id);
                    setAnchor(null);
                  }}
                >
                  <DatastoreAvatar label={displayName} colour={w.colour} size="md" />
                  <span className="DatastoreSwitcher__option-info">
                    <span className="DatastoreSwitcher__option-name">{displayName}</span>
                    {path && <span className="DatastoreSwitcher__option-path">{path}</span>}
                    {pathError && <span className="DatastoreSwitcher__option-path-error">API unavailable</span>}
                  </span>
                  {w.id === activeWorkspaceId && (
                    <CheckIcon className="DatastoreSwitcher__option-check" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <Divider />
        <button
          className="DatastoreSwitcher__action"
          onClick={() => {
            setAnchor(null);
            // TODO: open create-datastore dialog
          }}
        >
          <AddIcon />
          <span>Create new datastore</span>
        </button>
      </Popover>
    </>
  );
}
