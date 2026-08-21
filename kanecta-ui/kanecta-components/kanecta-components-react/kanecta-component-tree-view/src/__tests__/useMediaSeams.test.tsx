/**
 * Default media seams derived from `api.files` — the zero-wiring path every
 * TreeView host gets: a sync blob-URL resolver for inline image rendering and
 * an on-demand bytes fetcher for downloads.
 */
import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useMediaSeams } from '../hooks/useMediaSeams';
import type { TreeViewApi, KanectaItem } from '../types';

function apiWithFiles(get: ReturnType<typeof vi.fn>): TreeViewApi {
  return { files: { get } } as unknown as TreeViewApi;
}

// jsdom has no createObjectURL — stub it to a deterministic blob URL.
beforeEach(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

test('an api without files support yields no seams', () => {
  const { result } = renderHook(() => useMediaSeams({} as unknown as TreeViewApi));
  expect(result.current.resolveMediaUrl).toBeUndefined();
  expect(result.current.fetchFileBytes).toBeUndefined();
});

test('items without an image role resolve to undefined and fetch nothing', () => {
  const get = vi.fn();
  const { result } = renderHook(() => useMediaSeams(apiWithFiles(get)));
  expect(result.current.resolveMediaUrl!(item({ id: 'a' }))).toBeUndefined();
  expect(result.current.resolveMediaUrl!(item({ id: 'b', files: { file: 'report.pdf' } }))).toBeUndefined();
  expect(get).not.toHaveBeenCalled();
});

test('image-role items fetch once and resolve to a cached blob URL', async () => {
  let resolveFetch!: (b: Blob | null) => void;
  const get = vi.fn(() => new Promise<Blob | null>((r) => { resolveFetch = r; }));
  const { result } = renderHook(() => useMediaSeams(apiWithFiles(get)));
  const photo = item({ id: 'a', files: { image: 'photo.png' } });

  // First call: fetch kicked off (with the extension-derived mime), no URL yet.
  expect(result.current.resolveMediaUrl!(photo)).toBeUndefined();
  expect(get).toHaveBeenCalledWith('a', 'photo.png', 'image/png');

  await act(async () => resolveFetch(new Blob(['x'])));
  expect(result.current.resolveMediaUrl!(photo)).toBe('blob:test-1');
  // Cached — no second fetch for the same item/filename.
  expect(result.current.resolveMediaUrl!(photo)).toBe('blob:test-1');
  expect(get).toHaveBeenCalledTimes(1);
});

test('a missing sidecar (null) stays unresolved without refetch loops', async () => {
  const get = vi.fn(async () => null);
  const { result } = renderHook(() => useMediaSeams(apiWithFiles(get)));
  const gone = item({ id: 'a', files: { image: 'gone.png' } });

  expect(result.current.resolveMediaUrl!(gone)).toBeUndefined();
  await act(async () => {});
  expect(result.current.resolveMediaUrl!(gone)).toBeUndefined();
  expect(get).toHaveBeenCalledTimes(1);
});

test('blob URLs are revoked on unmount', async () => {
  const get = vi.fn(async () => new Blob(['x']));
  const { result, unmount } = renderHook(() => useMediaSeams(apiWithFiles(get)));
  result.current.resolveMediaUrl!(item({ id: 'a', files: { image: 'photo.png' } }));
  await act(async () => {});
  expect(result.current.resolveMediaUrl!(item({ id: 'a', files: { image: 'photo.png' } }))).toBe('blob:test-1');

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
});

test('fetchFileBytes downloads by role priority image > file > body', async () => {
  const blob = new Blob(['bytes']);
  const get = vi.fn(async () => blob);
  const { result } = renderHook(() => useMediaSeams(apiWithFiles(get)));

  await expect(result.current.fetchFileBytes!(item({ id: 'a' }))).resolves.toBeNull();
  expect(get).not.toHaveBeenCalled();

  await expect(
    result.current.fetchFileBytes!(item({ id: 'b', files: { body: 'notes.md', file: 'report.pdf' } })),
  ).resolves.toBe(blob);
  expect(get).toHaveBeenCalledWith('b', 'report.pdf', undefined);
});

function item(partial: { id: string; files?: Record<string, string> }): KanectaItem {
  return {
    value: '',
    type: 'file',
    sortOrder: 0,
    tags: [],
    createdAt: null,
    modifiedAt: null,
    ...partial,
  };
}
