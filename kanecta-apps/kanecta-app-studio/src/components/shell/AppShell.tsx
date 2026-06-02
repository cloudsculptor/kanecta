import { useCallback, useEffect } from 'react';
import { TopBar } from './TopBar';
import { LeftBar } from './LeftBar';
import { RightBar } from './RightBar';
import { BottomBar } from './BottomBar';
import { ItemOverlay } from './ItemOverlay';
import { useUiStore } from '../../store/ui';
import { useSettingsStore } from '../../store/settings';
import type { ViewType } from '../../types/ui';
import './AppShell.scss';

interface AppShellProps {
  children: React.ReactNode;
  onOpenQuickCapture?: () => void;
  onOpenCommandPalette?: () => void;
}

export function AppShell({
  children,
  onOpenQuickCapture,
  onOpenCommandPalette,
}: AppShellProps) {
  const { layout, updatePanel } = useUiStore();
  const { sidebarBg, sidebarFg, sidebarFgSelected, contentBg, contentBorder, showContentBorder, locationBorder } = useSettingsStore();

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
    <div className="AppShell" style={{ '--sidebar-bg': sidebarBg, '--sidebar-fg': sidebarFg, '--sidebar-fg-selected': sidebarFgSelected, '--content-bg': contentBg, '--content-border': contentBorder, '--location-border': locationBorder } as React.CSSProperties}>
      <ItemOverlay />
      <TopBar
        onQuickCapture={onOpenQuickCapture}
        onCommandPalette={onOpenCommandPalette}
        onViewSelect={handleViewSelect}
        activeView={activeView}
      />
      <LeftBar activeView={activeView} onViewSelect={handleViewSelect} />
      <main className="Content" style={{ background: contentBg, border: showContentBorder ? `1px solid ${contentBorder}` : 'none' }}>
        <div className="AppShell-main">{children}</div>
      </main>
      <RightBar activeView={activeView} onViewSelect={handleViewSelect} />
      <BottomBar activeView={activeView} onViewSelect={handleViewSelect} />
    </div>
  );
}
