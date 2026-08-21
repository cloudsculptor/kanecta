import { renderHook, act } from '@testing-library/react';
import { test, expect, beforeEach, vi } from 'vitest';
import { useMediaUrlResolver } from './useMediaUrlResolver';
import type { KanectaApi } from '../api';

function apiWithFiles(get: ReturnType<typeof vi.fn>): KanectaApi {
  return { files: { get } } as unknown as KanectaApi;
}

// jsdom has no createObjectURL — stub it to a deterministic blob URL.
beforeEach(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

test('items without an image role resolve to undefined and fetch nothing', () => {
  const get = vi.fn();
  const { result } = renderHook(() => useMediaUrlResolver(apiWithFiles(get)));
  expect(result.current({ id: 'a' })).toBeUndefined();
  expect(result.current({ id: 'b', files: { file: 'report.pdf' } })).toBeUndefined();
  expect(get).not.toHaveBeenCalled();
});

test('image-role items fetch once and resolve to a cached blob URL', async () => {
  let resolveFetch!: (b: Blob | null) => void;
  const get = vi.fn(() => new Promise<Blob | null>((r) => { resolveFetch = r; }));
  const { result } = renderHook(() => useMediaUrlResolver(apiWithFiles(get)));
  const item = { id: 'a', files: { image: 'photo.png' } };

  // First call: fetch kicked off (with the extension-derived mime), no URL yet.
  expect(result.current(item)).toBeUndefined();
  expect(get).toHaveBeenCalledWith('a', 'photo.png', 'image/png');

  await act(async () => resolveFetch(new Blob(['x'])));
  expect(result.current(item)).toBe('blob:test-1');
  // Cached — no second fetch for the same item/filename.
  expect(result.current(item)).toBe('blob:test-1');
  expect(get).toHaveBeenCalledTimes(1);
});

test('a missing sidecar (null) stays unresolved without refetch loops', async () => {
  const get = vi.fn(async () => null);
  const { result } = renderHook(() => useMediaUrlResolver(apiWithFiles(get)));
  const item = { id: 'a', files: { image: 'gone.png' } };

  expect(result.current(item)).toBeUndefined();
  await act(async () => {});
  expect(result.current(item)).toBeUndefined();
  expect(get).toHaveBeenCalledTimes(1);
});

test('blob URLs are revoked on unmount', async () => {
  const get = vi.fn(async () => new Blob(['x']));
  const { result, unmount } = renderHook(() => useMediaUrlResolver(apiWithFiles(get)));
  result.current({ id: 'a', files: { image: 'photo.png' } });
  await act(async () => {});
  expect(result.current({ id: 'a', files: { image: 'photo.png' } })).toBe('blob:test-1');

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
});
