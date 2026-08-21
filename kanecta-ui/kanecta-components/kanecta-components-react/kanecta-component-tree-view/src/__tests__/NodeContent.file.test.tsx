/**
 * File nodes: an item of type `file` renders as an inline image when its
 * sidecar role map carries an `image` role and the host resolver supplies a
 * URL; every other file renders an icon + name row (read-only UI — bytes are
 * written via MCP).
 */
import { render, screen } from '@testing-library/react';
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

test('file with image role renders the image via resolveMediaUrl', () => {
  const photo = item({ type: 'file', value: 'holiday.png', files: { image: 'holiday.png' } });
  const { container } = render(
    <NodeContent item={photo} resolveMediaUrl={(i) => (i.id === 'x' ? PNG_1x1 : undefined)} />,
  );
  const img = container.querySelector('img.NodeContent-image');
  expect(img).toHaveAttribute('src', PNG_1x1);
  expect(img).toHaveAttribute('alt', 'holiday.png');
  expect(container.querySelector('.NodeContent-file')).toBeNull();
});

test('file with image role but no resolvable URL falls back to the file row', () => {
  const photo = item({ type: 'file', value: 'holiday.png', files: { image: 'holiday.png' } });
  const { container } = render(<NodeContent item={photo} />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('.NodeContent-file')).toBeTruthy();
  expect(screen.getByText('holiday.png')).toBeInTheDocument();
});

test('file without an image role renders icon + name even when a URL resolves', () => {
  const doc = item({ type: 'file', value: 'report.pdf', files: { file: 'report.pdf' } });
  const { container } = render(<NodeContent item={doc} resolveMediaUrl={() => '/files/report.pdf'} />);
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByText('report.pdf')).toBeInTheDocument();
  // The resolved URL still powers the download affordance.
  const link = container.querySelector('a.NodeContent-file-download');
  expect(link).toHaveAttribute('href', '/files/report.pdf');
  expect(link).toHaveAttribute('download', 'report.pdf');
});

test('file with a body role (text/markdown sidecar) renders the file row', () => {
  const notes = item({ type: 'file', value: 'notes.md', files: { body: 'notes.md' } });
  const { container } = render(<NodeContent item={notes} />);
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByText('notes.md')).toBeInTheDocument();
});

test('symlink to an image-role file renders the image with a green bullet', () => {
  const TARGET_ID = '11111111-2222-4333-8444-555555555555';
  const photo = item({
    id: TARGET_ID,
    type: 'file',
    value: 'holiday.png',
    files: { image: 'holiday.png' },
  });
  const link = item({ id: 'link-1', type: 'symlink', value: TARGET_ID });
  const { container } = render(
    <NodeContent
      item={link}
      resolveId={(id) => (id === TARGET_ID ? photo : undefined)}
      resolveMediaUrl={(i) => (i.id === TARGET_ID ? PNG_1x1 : undefined)}
    />,
  );
  // Universal dispatch: the symlink renders its target's own renderer.
  expect(container.querySelector('img.NodeContent-image')).toHaveAttribute('src', PNG_1x1);
  const bullet = container.querySelector('.NodeContent-symlink-bullet');
  expect(bullet).toBeTruthy();
  expect(bullet).not.toHaveClass('is-broken');
});
