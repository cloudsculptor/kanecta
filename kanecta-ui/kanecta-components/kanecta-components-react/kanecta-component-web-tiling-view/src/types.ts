// A tiling tree of web panes. Mirrors the layouts-view split/leaf model, but a
// leaf holds a URL (rendered in an Electron <webview>) rather than a Studio view.

export interface WebLeafNode {
  type: 'leaf';
  id: string;
  url: string; // '' = the empty "new pane" state
}

export interface WebSplitNode {
  type: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  sizes: [number, number];
  children: [WebPaneNode, WebPaneNode];
}

export type WebPaneNode = WebLeafNode | WebSplitNode;

export interface QuickLink {
  label: string;
  url: string;
}
