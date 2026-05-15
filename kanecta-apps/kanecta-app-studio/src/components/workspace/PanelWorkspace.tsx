import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { PanelContainer } from './PanelContainer';
import { useUiStore } from '../../store/ui';
import './PanelWorkspace.scss';

interface PanelWorkspaceProps {
  renderView: (panelId: string, viewType: string) => React.ReactNode;
}

export function PanelWorkspace({ renderView }: PanelWorkspaceProps) {
  const { layout, setPanelSizes } = useUiStore();
  const { panels } = layout;

  return (
    <div className="PanelWorkspace">
      <PanelGroup
        direction="horizontal"
        onLayout={(sizes) => setPanelSizes(sizes)}
      >
        {panels.map((panel, i) => (
          <>
            <Panel key={panel.id} defaultSize={layout.sizes[i] ?? 100 / panels.length}>
              <PanelContainer panel={panel} canClose={panels.length > 1}>
                {renderView(panel.id, panel.viewType)}
              </PanelContainer>
            </Panel>
            {i < panels.length - 1 && (
              <PanelResizeHandle key={`handle-${panel.id}`} />
            )}
          </>
        ))}
      </PanelGroup>
    </div>
  );
}
