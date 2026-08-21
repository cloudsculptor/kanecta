import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { KanectaItem, TreeViewApi } from './types';
import type { FetchFileBytes, ResolveMediaUrl } from './components/NodeContent';

interface TreeViewContextValue {
  api: TreeViewApi;
  workspaceKey: string | undefined;
  vscodeAvailable: boolean;
  focusedItemId: string | null;
  /** When true, rows render a completion checkbox bound to completedAt (todo mode). */
  todoMode: boolean;
  onFocusItem: (id: string) => void;
  onSelectItem: (id: string | null) => void;
  onOpenOverlay: () => void;
  /**
   * Host seam for `table` nodes (spec §tablePayload): renders the node's inline
   * table preview — the host owns the grid component and the saved-query
   * execution path, keeping tree-view free of ag-grid. Absent (or returning
   * nothing) falls back to the plain text value.
   */
  renderTable?: (item: KanectaItem) => ReactNode;
  /**
   * Host seam for media bytes: maps an `image`/`file` item to a displayable
   * URL (typically an authenticated-fetch blob URL). See ResolveMediaUrl.
   */
  resolveMediaUrl?: ResolveMediaUrl;
  /**
   * Host seam for downloading a file item's stored bytes on demand (file
   * bytes live inside the datastore — sidecars / S3). See FetchFileBytes.
   */
  fetchFileBytes?: FetchFileBytes;
}

const TreeViewContext = createContext<TreeViewContextValue | null>(null);

export function useTreeViewContext(): TreeViewContextValue {
  const ctx = useContext(TreeViewContext);
  if (!ctx) throw new Error('useTreeViewContext must be used within TreeView');
  return ctx;
}

export { TreeViewContext };
