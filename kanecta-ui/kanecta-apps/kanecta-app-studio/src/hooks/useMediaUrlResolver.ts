import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { KanectaApi } from '../api';

/**
 * The slice of an item the resolver reads — structural so the same resolver
 * satisfies both the studio's and the tree-view package's KanectaItem shapes.
 */
export interface MediaItem {
  id: string;
  files?: Record<string, string>;
}

/**
 * Synchronous media resolver over the async, authenticated file bytes API.
 *
 * The tree-view's `resolveMediaUrl` seam is a plain `(item) => url` — but the
 * file bytes live behind `GET /items/:id/files/:name` with a bearer token, so
 * a bare `<img src>` can't reach them. This hook bridges the two: on first
 * call for an item it returns undefined and starts the fetch; when the bytes
 * land it caches a blob URL and re-renders, so the next call resolves.
 *
 * Only the `image` sidecar role is fetched — resolving would otherwise eagerly
 * download every visible file's bytes (PDFs, archives) just to render a row.
 * Blob URLs are revoked when the owning component unmounts.
 */
export function useMediaUrlResolver(api: KanectaApi): (item: MediaItem) => string | undefined {
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

  return useCallback((item: MediaItem) => {
    const filename = item.files?.image;
    if (!filename) return undefined;
    const key = `${item.id}/${filename}`;
    const cached = cacheRef.current.get(key);
    if (cached === 'pending' || cached === 'failed') return undefined;
    if (cached) return cached;

    cacheRef.current.set(key, 'pending');
    api.files
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
  }, [api]);
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
