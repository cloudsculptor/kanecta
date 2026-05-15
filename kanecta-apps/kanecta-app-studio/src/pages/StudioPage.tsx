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
import { ItemDetail } from '../components/item/ItemDetail';
import { QuickCapture } from '../components/shared/QuickCapture';
import { CommandPalette } from '../components/shared/CommandPalette';
import { useWorkspaceStore } from '../store/workspace';
import { useUiStore } from '../store/ui';
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
  const { getApi } = useWorkspaceStore();
  const { setFocusedItem, focusedItemId } = useUiStore();

  const { data: treeData } = useQuery({
    queryKey: ['all-items'],
    queryFn: () => getApi().tree.full(),
    staleTime: 10_000,
  });
  const allItems = treeData ? flattenTree(treeData) : [];

  const handleQuickCapture = (value: string) => {
    const api = getApi();
    void api.items.create({ value, type: 'note' }).then(() => {
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
      case 'table': return <TableView panelId={panelId} />;
      case 'board': return <BoardView panelId={panelId} />;
      case 'gallery': return <GalleryView panelId={panelId} />;
      case 'list': return <ListView panelId={panelId} />;
      case 'calendar': return <CalendarView panelId={panelId} />;
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

  return (
    <AppShell
      onOpenQuickCapture={() => setQuickCaptureOpen(true)}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
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
