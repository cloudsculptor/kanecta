import { IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import './RightPanel.scss';

interface RightPanelProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children?: React.ReactNode;
}

export function RightPanel({ open, title, onClose, children }: RightPanelProps) {
  return (
    <aside className={`RightPanel${open ? '' : ' RightPanel--closed'}`} aria-hidden={!open}>
      {open && (
        <>
          <div className="RightPanel-header">
            <span className="RightPanel-title">{title ?? 'Detail'}</span>
            <Tooltip title="Close panel">
              <IconButton size="small" onClick={onClose} aria-label="Close right panel">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </div>
          <div className="RightPanel-content">
            {children ?? (
              <div className="RightPanel-empty">Select an item to see its details</div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
