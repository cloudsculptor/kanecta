import {
  createElement, useState, useRef, useEffect, useCallback,
  type ReactNode, type KeyboardEvent, type MouseEvent as RMouseEvent,
} from 'react';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import RefreshIcon from '@mui/icons-material/Refresh';
import SplitscreenIcon from '@mui/icons-material/Splitscreen';
import CloseIcon from '@mui/icons-material/Close';
import HomeIcon from '@mui/icons-material/Home';
import type { WebPaneNode, WebLeafNode, WebSplitNode, QuickLink } from './types';
import './WebTilingView.scss';

function uid() { return crypto.randomUUID(); }

// Normalise a typed address into a loadable URL (add https:// if bare).
function normaliseUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?/.test(s)) return `http://${s}`;
  return `https://${s}`;
}

// The Electron <webview> element. Minimal ref surface for navigation.
interface WebviewEl extends HTMLElement {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
}

export interface WebTilingViewProps {
  /** URL used for the "home"/Kanecta quick action and default new panes. */
  homeUrl: string;
  /** Optional quick links shown on the empty pane. */
  quickLinks?: QuickLink[];
}

function WebLeafPane({
  node, onUpdate, onSplitH, onSplitV, onClose, canClose, homeUrl, quickLinks,
}: {
  node: WebLeafNode;
  onUpdate: (patch: Partial<WebLeafNode>) => void;
  onSplitH: () => void;
  onSplitV: () => void;
  onClose: () => void;
  canClose: boolean;
  homeUrl: string;
  quickLinks: QuickLink[];
}) {
  const webviewRef = useRef<WebviewEl | null>(null);
  const [address, setAddress] = useState(node.url);

  // Keep the address bar reflecting the live location as the webview navigates.
  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;
    const onNav = ((e: { url?: string }) => { if (e.url) setAddress(e.url); }) as EventListener;
    el.addEventListener('did-navigate', onNav);
    el.addEventListener('did-navigate-in-page', onNav);
    return () => {
      el.removeEventListener('did-navigate', onNav);
      el.removeEventListener('did-navigate-in-page', onNav);
    };
  }, [node.url]);

  useEffect(() => { setAddress(node.url); }, [node.url]);

  const go = (raw: string) => {
    const url = normaliseUrl(raw);
    if (url) onUpdate({ url });
  };

  const webview = node.url
    ? createElement('webview' as unknown as string, {
        ref: webviewRef,
        src: node.url,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allowpopups: 'true',
        className: 'WebTilingView-webview',
      })
    : (
      <div className="WebTilingView-empty">
        <div className="WebTilingView-empty-title">Open a page</div>
        <div className="WebTilingView-quicklinks">
          {[{ label: 'Kanecta', url: homeUrl }, ...quickLinks].map((q) => (
            <button key={q.url} className="WebTilingView-quicklink" onClick={() => go(q.url)}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="WebTilingView-empty-hint">…or type a URL above and press Enter.</div>
      </div>
    );

  return (
    <div className="WebTilingView-leaf">
      <div className="WebTilingView-leaf-toolbar">
        <button className="WebTilingView-btn" title="Back" onClick={() => webviewRef.current?.goBack()}>
          <ArrowBackIcon style={{ fontSize: 16 }} />
        </button>
        <button className="WebTilingView-btn" title="Forward" onClick={() => webviewRef.current?.goForward()}>
          <ArrowForwardIcon style={{ fontSize: 16 }} />
        </button>
        <button className="WebTilingView-btn" title="Reload" onClick={() => webviewRef.current?.reload()}>
          <RefreshIcon style={{ fontSize: 16 }} />
        </button>
        <button className="WebTilingView-btn" title="Home (Kanecta)" onClick={() => go(homeUrl)}>
          <HomeIcon style={{ fontSize: 16 }} />
        </button>
        <input
          className="WebTilingView-address"
          value={address}
          placeholder="Enter a URL…"
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') go(address); }}
        />
        <div className="WebTilingView-leaf-actions">
          <button className="WebTilingView-btn" title="Split horizontal" onClick={onSplitH}>
            <SplitscreenIcon style={{ transform: 'rotate(90deg)', fontSize: 16 }} />
          </button>
          <button className="WebTilingView-btn" title="Split vertical" onClick={onSplitV}>
            <SplitscreenIcon style={{ fontSize: 16 }} />
          </button>
          {canClose && (
            <button className="WebTilingView-btn WebTilingView-btn--close" title="Close pane" onClick={onClose}>
              <CloseIcon style={{ fontSize: 16 }} />
            </button>
          )}
        </div>
      </div>
      <div className="WebTilingView-leaf-content">{webview}</div>
    </div>
  );
}

function WebSplitPane({
  node, onUpdate, onReplace, isRoot, homeUrl, quickLinks,
}: {
  node: WebSplitNode;
  onUpdate: (updated: WebSplitNode) => void;
  onReplace: (replacement: WebPaneNode) => void;
  isRoot: boolean;
  homeUrl: string;
  quickLinks: QuickLink[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleDragStart = (e: RMouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (me: globalThis.MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let ratio = node.direction === 'horizontal'
        ? (me.clientX - rect.left) / rect.width
        : (me.clientY - rect.top) / rect.height;
      ratio = Math.max(0.1, Math.min(0.9, ratio));
      onUpdate({ ...node, sizes: [ratio * 100, (1 - ratio) * 100] });
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const updateChild = (index: 0 | 1, updated: WebPaneNode) => {
    const children: [WebPaneNode, WebPaneNode] = [...node.children] as [WebPaneNode, WebPaneNode];
    children[index] = updated;
    onUpdate({ ...node, children });
  };

  const removeChild = (index: 0 | 1) => onReplace(node.children[index === 0 ? 1 : 0]);

  const splitLeaf = (index: 0 | 1, direction: 'horizontal' | 'vertical') => {
    const target = node.children[index];
    const newLeaf: WebLeafNode = { type: 'leaf', id: uid(), url: '' };
    updateChild(index, { type: 'split', id: uid(), direction, sizes: [50, 50], children: [target, newLeaf] });
  };

  const renderNode = (child: WebPaneNode, index: 0 | 1): ReactNode => {
    if (child.type === 'leaf') {
      return (
        <WebLeafPane
          key={child.id}
          node={child}
          onUpdate={(patch) => updateChild(index, { ...child, ...patch })}
          onSplitH={() => splitLeaf(index, 'horizontal')}
          onSplitV={() => splitLeaf(index, 'vertical')}
          onClose={() => removeChild(index)}
          canClose={!isRoot || node.children.length > 1}
          homeUrl={homeUrl}
          quickLinks={quickLinks}
        />
      );
    }
    return (
      <WebSplitPane
        key={child.id}
        node={child}
        onUpdate={(updated) => updateChild(index, updated)}
        onReplace={(replacement) => updateChild(index, replacement)}
        isRoot={false}
        homeUrl={homeUrl}
        quickLinks={quickLinks}
      />
    );
  };

  return (
    <div ref={containerRef} className={`WebTilingView-split WebTilingView-split--${node.direction}`}>
      <div className="WebTilingView-split-child" style={{ flexBasis: `${node.sizes[0]}%` }}>
        {renderNode(node.children[0], 0)}
      </div>
      <div
        className={`WebTilingView-divider WebTilingView-divider--${node.direction}`}
        onMouseDown={handleDragStart}
      />
      <div className="WebTilingView-split-child" style={{ flexBasis: `${node.sizes[1]}%` }}>
        {renderNode(node.children[1], 1)}
      </div>
    </div>
  );
}

export function WebTilingView({ homeUrl, quickLinks = [] }: WebTilingViewProps) {
  const [root, setRoot] = useState<WebPaneNode>(() => ({ type: 'leaf', id: uid(), url: '' }));

  const splitRoot = useCallback((direction: 'horizontal' | 'vertical') => {
    setRoot((prev) => ({
      type: 'split', id: uid(), direction, sizes: [50, 50],
      children: [prev, { type: 'leaf', id: uid(), url: '' }],
    }));
  }, []);

  return (
    <div className="WebTilingView">
      {root.type === 'leaf' ? (
        <WebLeafPane
          node={root}
          onUpdate={(patch) => setRoot((prev) => ({ ...(prev as WebLeafNode), ...patch }))}
          onSplitH={() => splitRoot('horizontal')}
          onSplitV={() => splitRoot('vertical')}
          onClose={() => {}}
          canClose={false}
          homeUrl={homeUrl}
          quickLinks={quickLinks}
        />
      ) : (
        <WebSplitPane
          node={root}
          onUpdate={setRoot}
          onReplace={setRoot}
          isRoot
          homeUrl={homeUrl}
          quickLinks={quickLinks}
        />
      )}
    </div>
  );
}
