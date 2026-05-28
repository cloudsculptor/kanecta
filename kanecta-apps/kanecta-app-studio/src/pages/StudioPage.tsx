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
import { MissionControl } from '../components/views/MissionControl/MissionControl';
import { QualityControlView } from '../components/views/QualityControlView/QualityControlView';
import { HistoryView } from '../components/views/HistoryView/HistoryView';
import { TemplatesView } from '../components/views/TemplatesView/TemplatesView';
import { StarredView } from '../components/views/StarredView/StarredView';
import { DigestView } from '../components/views/MissionControl/DigestView';
import { AIInstructionsView } from '../components/views/AIInstructionsView/AIInstructionsView';
import { ReviewConveyor } from '../components/views/MissionControl/ReviewConveyor';
import { ItemDetail } from '../components/item/ItemDetail';
import { QuickCapture } from '../components/shared/QuickCapture';
import { CommandPalette } from '../components/shared/CommandPalette';
import { SettingsPage } from './SettingsPage';
import { useWorkspaceStore } from '../store/workspace';
import { useUiStore } from '../store/ui';
import { useLiveActivity } from '../hooks/useLiveActivity';
import { flattenTree } from '../lib/items';
import type { KanectaItem } from '../types/kanecta';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { getApi } = useWorkspaceStore();
  const { setFocusedItem, focusedItemId } = useUiStore();

  useLiveActivity();

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
    setFocusedItem(item.id);
  };

  const renderView = (panelId: string, viewType: string) => {
    switch (viewType) {
      case 'tree': return <TreeView panelId={panelId} />;
      case 'table': return <TableView />;
      case 'templates': return <TemplatesView />;
      case 'board': return <BoardView panelId={panelId} />;
      case 'gallery': return <GalleryView panelId={panelId} />;
      case 'list': return <ListView panelId={panelId} />;
      case 'calendar': return <CalendarView panelId={panelId} />;
      case 'graph': return <GraphView />;
      case 'mission-control': return <MissionControl />;
      case 'quality-control': return <QualityControlView />;
      case 'history': return <HistoryView />;
      case 'starred': return <StarredView />;
      case 'digest': return <DigestView />;
      case 'ai-instructions': return <AIInstructionsView />;
      default:
        return (
          <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            {viewType} view coming soon
          </div>
        );
    }
  };

  const focusedItem = focusedItemId
    ? allItems.find((i) => i.id === focusedItemId)
    : undefined;

  if (settingsOpen) {
    return (
      <QueryClientProvider client={qc}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <SettingsPage onClose={() => setSettingsOpen(false)} />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  if (reviewOpen) {
    return (
      <ReviewConveyor onClose={() => setReviewOpen(false)} />
    );
  }

  return (
    <AppShell
      onOpenQuickCapture={() => setQuickCaptureOpen(true)}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenReview={() => setReviewOpen(true)}
      rightPanelTitle={focusedItem?.value}
      rightPanelContent={focusedItemId ? <ItemDetail itemId={focusedItemId} /> : undefined}
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
        <StudioInner />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
