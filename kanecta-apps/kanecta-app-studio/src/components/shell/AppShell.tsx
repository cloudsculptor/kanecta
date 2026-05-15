import { useCallback, useEffect } from 'react';
import { TopBar } from './TopBar';
import { LeftSidebar } from './LeftSidebar';
import { RightPanel } from './RightPanel';
import { BottomBar } from './BottomBar';
import { useUiStore } from '../../store/ui';
import { useWorkspaceStore } from '../../store/workspace';
import type { ViewType } from '../../types/ui';
import './AppShell.scss';

interface AppShellProps {
  children: React.ReactNode;
  rightPanelContent?: React.ReactNode;
  rightPanelTitle?: string;
  quickCaptureNode?: React.ReactNode;
  commandPaletteNode?: React.ReactNode;
  onOpenQuickCapture?: () => void;
  onOpenCommandPalette?: () => void;
}

export function AppShell({
  children,
  rightPanelContent,
  rightPanelTitle,
  onOpenQuickCapture,
  onOpenCommandPalette,
}: AppShellProps) {
  const { sidebarState, setSidebarState, rightPanelOpen, setRightPanelOpen, layout, updatePanel } =
    useUiStore();
  const { getActiveWorkspace } = useWorkspaceStore();
  const workspace = getActiveWorkspace();

  const activeView = layout.panels[0]?.viewType ?? 'tree';

  const handleViewSelect = useCallback(
    (view: ViewType) => {
      const panelId = layout.panels[0]?.id;
      if (panelId) updatePanel(panelId, { viewType: view });
    },
    [layout.panels, updatePanel],
  );

  const handleSidebarToggle = useCallback(() => {
    setSidebarState(sidebarState === 'expanded' ? 'icons' : 'expanded');
  }, [sidebarState, setSidebarState]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        onOpenQuickCapture?.();
      }
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        onOpenCommandPalette?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenQuickCapture, onOpenCommandPalette]);

  return (
    <div className="AppShell">
      <TopBar onQuickCapture={onOpenQuickCapture} onCommandPalette={onOpenCommandPalette} />
      <div className="AppShell-body">
        <LeftSidebar
          state={sidebarState}
          activeView={activeView}
          onViewSelect={handleViewSelect}
          onToggle={handleSidebarToggle}
        />
        <main className="AppShell-main">{children}</main>
        <RightPanel
          open={rightPanelOpen}
          title={rightPanelTitle}
          onClose={() => setRightPanelOpen(false)}
        >
          {rightPanelContent}
        </RightPanel>
      </div>
      <BottomBar workspace={workspace} />
    </div>
  );
}
