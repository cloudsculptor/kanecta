import type { PanelConfig } from '../../types/ui';
import './PanelContainer.scss';

interface PanelContainerProps {
  panel: PanelConfig;
  canClose?: boolean;
  children: React.ReactNode;
}

export function PanelContainer({ children }: PanelContainerProps) {
  return (
    <div className="PanelContainer">
      <div className="PanelContainer-content">{children}</div>
    </div>
  );
}
