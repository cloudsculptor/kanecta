export interface LeafNode {
  type: 'leaf';
  id: string;
  viewType: string | null;
  itemId: string | null;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  sizes: [number, number];
  children: [PaneNode, PaneNode];
}

export type PaneNode = LeafNode | SplitNode;

export interface LayoutTab {
  id: string;
  label: string;
  root: PaneNode;
}

export interface LayoutData {
  activeTabId: string;
  tabs: LayoutTab[];
}
