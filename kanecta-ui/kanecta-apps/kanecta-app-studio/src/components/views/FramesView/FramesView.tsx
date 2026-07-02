import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { WebTilingView } from '@kanecta/component-web-tiling-view';

export const FramesViewMeta: ViewMeta = {
  uuid: 'c3f1a2b4-5d6e-4f70-8a91-b2c3d4e5f601',
  name: 'frames',
  label: 'Frames',
  icon: 'GridView',
};

// A tiling window manager of web panes — Kanecta plus any website. Electron-only
// (each pane is a <webview>); does not replace the internal Layouts view.
export function FramesView() {
  useViewLocation(FramesViewMeta.uuid);
  const homeUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9743';
  return <WebTilingView homeUrl={homeUrl} />;
}
