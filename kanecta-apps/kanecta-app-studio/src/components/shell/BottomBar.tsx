import type { WorkspaceConfig } from '../../types/workspace';
import './BottomBar.scss';

interface BottomBarProps {
  workspace?: WorkspaceConfig;
  statusText?: string;
}

export function BottomBar({ workspace, statusText }: BottomBarProps) {
  return (
    <footer className="BottomBar">
      {workspace && (
        <div className="BottomBar-workspace">
          <span className="BottomBar-dot" style={{ color: workspace.colour }} />
          {workspace.name}
        </div>
      )}
      <div className="BottomBar-spacer" />
      {statusText && <span className="BottomBar-status">{statusText}</span>}
    </footer>
  );
}
