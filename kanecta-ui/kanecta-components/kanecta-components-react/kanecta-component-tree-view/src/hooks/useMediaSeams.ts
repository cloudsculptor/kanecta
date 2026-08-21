import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { TreeViewApi, KanectaItem } from '../types';
import type { ResolveMediaUrl, FetchFileBytes } from '../components/NodeContent';

/**
 * Default media seams, derived from `api.files` so every TreeView host gets
 * inline image rendering and click-to-download on file nodes without wiring
 * anything — hosts can still override via the `resolveMediaUrl` /
 * `fetchFileBytes` props.
 *
 * resolveMediaUrl bridges the sync `(item) => url` seam over the async,
 * authenticated bytes API (`GET /items/:id/files/:name` needs a bearer token,
 * so a bare `<img src>` can't reach it): the first call for an item returns
 * undefined and starts the fetch; when the bytes land a blob URL is cached and
 * a re-render makes the next call resolve. Only the `image` sidecar role is
 * fetched — resolving would otherwise eagerly download every visible file's
 * bytes (PDFs, archives) just to render a row. Blob URLs are revoked on
 * unmount.
 *
 * fetchFileBytes is on-demand (nothing until the user asks), so any role —
 * PDFs, archives — is fair game.
 */
export function useMediaSeams(api: TreeViewApi): {
  resolveMediaUrl?: ResolveMediaUrl;
  fetchFileBytes?: FetchFileBytes;
} {
  const filesApi = api.files;

  // key `${itemId}/${filename}` → blob URL, or a fetch-state sentinel. Lives
  // in a ref so the cache survives the resolver being re-created when the
  // host passes a fresh api object.
  const cacheRef = useRef(new Map<string, string>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  const resolveMediaUrl = useCallback(
    (item: KanectaItem) => {
      if (!filesApi) return undefined;
      const filename = item.files?.image;
      if (!filename) return undefined;
      const key = `${item.id}/${filename}`;
      const cached = cacheRef.current.get(key);
      if (cached === 'pending' || cached === 'failed') return undefined;
      if (cached) return cached;

      cacheRef.current.set(key, 'pending');
      filesApi
        .get(item.id, filename, mimeFromFilename(filename))
        .then((blob) => {
          if (blob) {
            cacheRef.current.set(key, URL.createObjectURL(blob));
            rerender();
          } else {
            cacheRef.current.set(key, 'failed');
          }
        })
        .catch(() => cacheRef.current.set(key, 'failed'));
      return undefined;
    },
    [filesApi],
  );

  const fetchFileBytes = useCallback(
    async (item: KanectaItem) => {
      if (!filesApi) return null;
      const filename = item.files?.image ?? item.files?.file ?? item.files?.body;
      if (!filename) return null;
      return filesApi.get(item.id, filename, mimeFromFilename(filename));
    },
    [filesApi],
  );

  if (!filesApi) return {};
  return { resolveMediaUrl, fetchFileBytes };
}

// The server stores bytes only and serves octet-stream unless told otherwise;
// the sidecar filename is the one mime hint the tree row carries.
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
};

function mimeFromFilename(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_MIME_BY_EXT[ext] : undefined;
}
