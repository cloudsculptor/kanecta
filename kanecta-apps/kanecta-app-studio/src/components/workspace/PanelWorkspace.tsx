import { Fragment } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
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
          <Fragment key={panel.id}>
            <Panel defaultSize={layout.sizes[i] ?? 100 / panels.length}>
              <PanelContainer panel={panel} canClose={panels.length > 1}>
                {renderView(panel.id, panel.viewType)}
              </PanelContainer>
            </Panel>
            {i < panels.length - 1 && <PanelResizeHandle />}
          </Fragment>
        ))}
      </PanelGroup>
    </div>
  );
}
