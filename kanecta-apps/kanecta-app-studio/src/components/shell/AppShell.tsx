import { useCallback, useEffect } from 'react';
import { TopBar } from './TopBar';
import { LeftBar } from './LeftBar';
import { RightBar } from './RightBar';
import { RightPanel } from './RightPanel';
import { BottomBar } from './BottomBar';
import { useUiStore } from '../../store/ui';
import { useSettingsStore } from '../../store/settings';
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
  onOpenSettings?: () => void;
}

export function AppShell({
  children,
  rightPanelContent,
  rightPanelTitle,
  onOpenQuickCapture,
  onOpenCommandPalette,
  onOpenSettings,
}: AppShellProps) {
  const { rightPanelOpen, setRightPanelOpen, layout, updatePanel } = useUiStore();
  const { background, foreground, contentBackground, contentForeground } = useSettingsStore();

  const activeView = layout.panels[0]?.viewType ?? 'tree';

  const handleViewSelect = useCallback(
    (view: ViewType) => {
      const panelId = layout.panels[0]?.id;
      if (panelId) updatePanel(panelId, { viewType: view });
      if (view !== 'tree') {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    },
    [layout.panels, updatePanel],
  );

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
    <div className="AppShell" style={{ backgroundColor: background, '--theme-fg': foreground, '--content-bg': contentBackground, '--content-fg': contentForeground } as React.CSSProperties}>
      <TopBar
        onQuickCapture={onOpenQuickCapture}
        onCommandPalette={onOpenCommandPalette}
        onOpenSettings={onOpenSettings}
      />
      <LeftBar activeView={activeView} onViewSelect={handleViewSelect} />
      <main className="Content" style={{ background: contentBackground }}>
        <div className="AppShell-main">{children}</div>
        <RightPanel
          open={rightPanelOpen}
          title={rightPanelTitle}
          onClose={() => setRightPanelOpen(false)}
        >
          {rightPanelContent}
        </RightPanel>
      </main>
      <RightBar activeView={activeView} onViewSelect={handleViewSelect} />
      <BottomBar onHome={() => handleViewSelect('tree')} />
    </div>
  );
}
