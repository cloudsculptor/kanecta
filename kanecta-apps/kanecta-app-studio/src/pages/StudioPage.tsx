import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AppShell } from '../components/shell/AppShell';
import { PanelWorkspace } from '../components/workspace/PanelWorkspace';
import { TreeView } from '../components/views/TreeView/TreeView';
import { TableView } from '../components/views/TableView/TableView';
import { BoardView } from '../components/views/BoardView/BoardView';
import { GalleryView } from '../components/views/GalleryView/GalleryView';
import { ListView } from '../components/views/ListView/ListView';
import { CalendarView } from '../components/views/CalendarView/CalendarView';
import { GraphView } from '../components/views/GraphView/GraphView';
import { CombinatorView } from '../components/views/CombinatorView/CombinatorView';
import { MissionControl } from '../components/views/MissionControl/MissionControl';
import { QualityControlView } from '../components/views/QualityControlView/QualityControlView';
import { HistoryView } from '../components/views/HistoryView/HistoryView';
import { TypesView } from '../components/views/TemplatesView/TypesView';
import { StarredView } from '../components/views/StarredView/StarredView';
import { DigestView } from '../components/views/MissionControl/DigestView';
import { AIInstructionsView } from '../components/views/AIInstructionsView/AIInstructionsView';
import { ClaudeView } from '../components/views/ClaudeView/ClaudeView';
import { HomeView } from '../components/views/HomeView/HomeView';
import { DiagramView } from '../components/views/DiagramView/DiagramView';
import { QuickCapture } from '../components/shared/QuickCapture';
import { CommandPalette } from '../components/shared/CommandPalette';
import { SettingsPage } from './SettingsPage';
import { LocationProvider } from '../context/LocationContext';
import { useWorkspaceStore } from '../store/workspace';
import { useSettingsStore, THEMES } from '../store/settings';
import { useLiveActivity } from '../hooks/useLiveActivity';
import { flattenTree } from '../lib/items';
import type { KanectaItem } from '../types/kanecta';
import { useLocation } from '../context/LocationContext';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

const theme = createTheme({
  colorSchemes: { dark: true },
  typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
});

function StudioInner() {
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const { getApi } = useWorkspaceStore();
  const { applyTheme } = useSettingsStore();
  const { setItemId } = useLocation();

  useLiveActivity();

  useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const s = await getApi().settings.get();
      const theme = THEMES.find(t => t.name === s.themeName) ?? { ...s, name: s.themeName };
      applyTheme(theme);
      return s;
    },
    staleTime: Infinity,
  });

  const { data: treeData } = useQuery({
    queryKey: ['all-items'],
    queryFn: () => getApi().tree.full(),
    staleTime: 10_000,
  });
  const allItems = treeData ? flattenTree(treeData) : [];

  const handleQuickCapture = (value: string) => {
    const api = getApi();
    void api.items.create({ value, type: 'text' }).then(() => {
      void qc.invalidateQueries({ queryKey: ['tree-children', null] });
      void qc.invalidateQueries({ queryKey: ['all-items'] });
    });
  };

  const handleSelectItem = (item: KanectaItem) => {
    setItemId(item.id);
  };

  const renderView = (panelId: string, viewType: string) => {
    switch (viewType) {
      case 'tree': return <TreeView panelId={panelId} />;
      case 'table': return <TableView />;
      case 'types': return <TypesView />;
      case 'board': return <BoardView panelId={panelId} />;
      case 'gallery': return <GalleryView panelId={panelId} />;
      case 'list': return <ListView panelId={panelId} />;
      case 'calendar': return <CalendarView panelId={panelId} />;
      case 'graph': return <GraphView />;
      case 'combinator': return <CombinatorView />;
      case 'mission-control': return <MissionControl />;
      case 'quality-control': return <QualityControlView />;
      case 'history': return <HistoryView />;
      case 'starred': return <StarredView />;
      case 'digest': return <DigestView />;
      case 'ai-instructions': return <AIInstructionsView />;
      case 'claude': return <ClaudeView />;
      case 'settings': return <SettingsPage />;
      case 'home': return <HomeView />;
      case 'diagram': return <DiagramView />;
      default:
        return (
          <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            {viewType} view coming soon
          </div>
        );
    }
  };

  return (
    <AppShell
      onOpenQuickCapture={() => setQuickCaptureOpen(true)}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
    >
      <PanelWorkspace renderView={renderView} />
      <QuickCapture
        open={quickCaptureOpen}
        onClose={() => setQuickCaptureOpen(false)}
        onSubmit={handleQuickCapture}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        items={allItems}
        commands={[]}
        onSelectItem={handleSelectItem}
      />
    </AppShell>
  );
}

export function StudioPage() {
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocationProvider>
          <StudioInner />
        </LocationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
