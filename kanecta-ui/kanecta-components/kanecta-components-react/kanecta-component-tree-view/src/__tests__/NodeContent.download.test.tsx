/**
 * Download interactions on file nodes (bytes live in the datastore's file
 * storage and are fetched on demand via the fetchFileBytes host seam):
 * - non-image file rows download on click, behind a confirmation dialog
 * - images grow a hover download overlay button (no dialog)
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { NodeContent } from '../components/NodeContent';
import type { KanectaItem } from '../types';

const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function item(partial: Partial<KanectaItem>): KanectaItem {
  return {
    id: 'x',
    value: '',
    type: 'text',
    sortOrder: 0,
    tags: [],
    createdAt: null,
    modifiedAt: null,
    childCount: 0,
    ...partial,
  };
}

let anchorClicks: string[];

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:saved');
  URL.revokeObjectURL = vi.fn();
  // Record programmatic anchor clicks (saveBlob's download trigger) without
  // jsdom attempting a navigation.
  anchorClicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchorClicks.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('file row click opens the confirm dialog; confirming downloads the bytes', async () => {
  const fetchFileBytes = vi.fn(async () => new Blob(['pdf bytes']));
  const doc = item({ type: 'file', value: 'Report', files: { file: 'report.pdf' } });
  const { container } = render(<NodeContent item={doc} fetchFileBytes={fetchFileBytes} />);

  const row = container.querySelector('.NodeContent-file--downloadable')!;
  expect(row).toBeTruthy();
  fireEvent.click(row);

  // Dialog up, nothing fetched yet.
  expect(screen.getByText('Download file?')).toBeInTheDocument();
  expect(fetchFileBytes).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(anchorClicks).toEqual(['report.pdf']));
  expect(fetchFileBytes).toHaveBeenCalledWith(doc);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:saved');
});

test('cancelling the dialog fetches nothing', async () => {
  const fetchFileBytes = vi.fn(async () => new Blob(['x']));
  const doc = item({ type: 'file', value: 'notes.txt', files: { body: 'notes.txt' } });
  const { container } = render(<NodeContent item={doc} fetchFileBytes={fetchFileBytes} />);

  fireEvent.click(container.querySelector('.NodeContent-file--downloadable')!);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByText('Download file?')).not.toBeInTheDocument());
  expect(fetchFileBytes).not.toHaveBeenCalled();
  expect(anchorClicks).toEqual([]);
});

test('without the seam a file row keeps the legacy plain-anchor behavior', () => {
  const doc = item({ type: 'file', value: '/files/report.pdf' });
  const { container } = render(<NodeContent item={doc} />);
  expect(container.querySelector('.NodeContent-file--downloadable')).toBeNull();
  expect(container.querySelector('a.NodeContent-file-download')).toHaveAttribute(
    'download',
    'report.pdf',
  );
});

test('image-role files get a download overlay that saves without a dialog', async () => {
  const fetchFileBytes = vi.fn(async () => new Blob(['png bytes']));
  const photo = item({ type: 'file', value: 'holiday.png', files: { image: 'holiday.png' } });
  const { container } = render(
    <NodeContent item={photo} resolveMediaUrl={() => PNG_1x1} fetchFileBytes={fetchFileBytes} />,
  );

  expect(container.querySelector('img.NodeContent-image')).toBeTruthy();
  const overlay = container.querySelector('.NodeContent-image-download')!;
  fireEvent.click(overlay);

  await waitFor(() => expect(anchorClicks).toEqual(['holiday.png']));
  expect(fetchFileBytes).toHaveBeenCalledWith(photo);
  expect(screen.queryByText('Download file?')).not.toBeInTheDocument();
});

test('a file with no stored bytes renders the plain row even with the seam', () => {
  const fetchFileBytes = vi.fn(async () => new Blob(['x']));
  const doc = item({ type: 'file', value: 'notes.txt' }); // no files role map
  const { container } = render(<NodeContent item={doc} fetchFileBytes={fetchFileBytes} />);
  expect(container.querySelector('.NodeContent-file--downloadable')).toBeNull();
  expect(container.querySelector('.NodeContent-file-downloadIcon')).toBeNull();
});

test('a URL-value image with no stored bytes gets no overlay even with the seam', () => {
  const photo = item({ type: 'image', value: PNG_1x1 }); // src from value, nothing stored
  const { container } = render(
    <NodeContent item={photo} fetchFileBytes={vi.fn(async () => new Blob(['x']))} />,
  );
  expect(container.querySelector('img.NodeContent-image')).toBeTruthy();
  expect(container.querySelector('.NodeContent-image-download')).toBeNull();
});

test('a null byte fetch keeps the dialog open with an error and a Retry button', async () => {
  const fetchFileBytes = vi.fn(async () => null);
  const doc = item({ type: 'file', value: 'Report', files: { file: 'report.pdf' } });
  const { container } = render(<NodeContent item={doc} fetchFileBytes={fetchFileBytes} />);

  fireEvent.click(container.querySelector('.NodeContent-file--downloadable')!);
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));

  await waitFor(() =>
    expect(screen.getByText(/No stored bytes came back/)).toBeInTheDocument(),
  );
  expect(screen.getByText('Download file?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(anchorClicks).toEqual([]);
});

test('a rejected byte fetch surfaces its message in the dialog', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetchFileBytes = vi.fn(async () => {
    throw new Error('boom');
  });
  const doc = item({ type: 'file', value: 'Report', files: { file: 'report.pdf' } });
  const { container } = render(<NodeContent item={doc} fetchFileBytes={fetchFileBytes} />);

  fireEvent.click(container.querySelector('.NodeContent-file--downloadable')!);
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));

  await waitFor(() => expect(screen.getByText(/Download failed: boom/)).toBeInTheDocument());
  expect(anchorClicks).toEqual([]);
});

test('a failed image overlay download marks the button for retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetchFileBytes = vi.fn(async () => {
    throw new Error('offline');
  });
  const photo = item({ type: 'file', value: 'holiday.png', files: { image: 'holiday.png' } });
  const { container } = render(
    <NodeContent item={photo} resolveMediaUrl={() => PNG_1x1} fetchFileBytes={fetchFileBytes} />,
  );

  fireEvent.click(container.querySelector('.NodeContent-image-download')!);
  await waitFor(() =>
    expect(container.querySelector('.NodeContent-image-download.is-failed')).toBeTruthy(),
  );
  expect(anchorClicks).toEqual([]);
});

test('images without the seam render with no overlay button', () => {
  const photo = item({ type: 'image', value: PNG_1x1 });
  const { container } = render(<NodeContent item={photo} />);
  expect(container.querySelector('img.NodeContent-image')).toBeTruthy();
  expect(container.querySelector('.NodeContent-image-download')).toBeNull();
});

test('a symlink to a file passes the download seam through to the target', async () => {
  const TARGET_ID = '11111111-2222-4333-8444-555555555555';
  const fetchFileBytes = vi.fn(async () => new Blob(['x']));
  const doc = item({ id: TARGET_ID, type: 'file', value: 'notes.txt', files: { body: 'notes.txt' } });
  const link = item({ id: 'link-1', type: 'symlink', value: TARGET_ID });
  const { container } = render(
    <NodeContent
      item={link}
      resolveId={(id) => (id === TARGET_ID ? doc : undefined)}
      fetchFileBytes={fetchFileBytes}
    />,
  );

  fireEvent.click(container.querySelector('.NodeContent-file--downloadable')!);
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(fetchFileBytes).toHaveBeenCalledWith(doc));
});
