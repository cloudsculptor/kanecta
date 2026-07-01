import { createContext, useContext } from 'react';
import type { TreeViewApi } from './types';

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
}

const TreeViewContext = createContext<TreeViewContextValue | null>(null);

export function useTreeViewContext(): TreeViewContextValue {
  const ctx = useContext(TreeViewContext);
  if (!ctx) throw new Error('useTreeViewContext must be used within TreeView');
  return ctx;
}

export { TreeViewContext };
