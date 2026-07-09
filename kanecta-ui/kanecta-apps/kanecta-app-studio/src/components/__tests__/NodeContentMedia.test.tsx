import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NodeContent } from '@kanecta/component-tree-view';
import type { KanectaItem } from '@kanecta/component-tree-view';

// A 1×1 transparent PNG — a self-contained image source (no network).
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeItem(partial: Partial<KanectaItem> & { value: string; type: string }): KanectaItem {
  return { id: 'x', typeId: null, sortOrder: 0, tags: [], createdAt: null, modifiedAt: null, ...partial };
}

describe('NodeContent media rendering', () => {
  it('renders an <img> for an image node whose value is a data URI', () => {
    render(<NodeContent item={makeItem({ type: 'image', value: PNG })} />);
    const img = document.querySelector('img.NodeContent-image');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(PNG);
  });

  it('renders an <img> for an image node whose value is an http(s) URL', () => {
    render(<NodeContent item={makeItem({ type: 'image', value: 'https://example.com/p.png' })} />);
    expect(document.querySelector('img.NodeContent-image')?.getAttribute('src')).toBe('https://example.com/p.png');
  });

  it('uses a host resolveMediaUrl when the value is not itself a URL', () => {
    render(<NodeContent item={makeItem({ type: 'image', value: 'stored' })} resolveMediaUrl={() => PNG} />);
    expect(document.querySelector('img.NodeContent-image')?.getAttribute('src')).toBe(PNG);
  });

  it('falls back to text when an image has no resolvable source', () => {
    render(<NodeContent item={makeItem({ type: 'image', value: 'my-photo' })} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('my-photo')).toBeTruthy();
  });

  it('renders a filename and download link for a file node with a URL/path', () => {
    render(<NodeContent item={makeItem({ type: 'file', value: '/files/report.pdf' })} />);
    expect(screen.getByText('report.pdf')).toBeTruthy();
    const link = document.querySelector('a.NodeContent-file-download');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('download')).toBe('report.pdf');
  });

  it('renders a filename without a download link when a file has no URL', () => {
    render(<NodeContent item={makeItem({ type: 'file', value: 'notes.txt' })} />);
    expect(screen.getByText('notes.txt')).toBeTruthy();
    expect(document.querySelector('a.NodeContent-file-download')).toBeNull();
  });

  it('renders a grid affordance carrying the label', () => {
    render(<NodeContent item={makeItem({ type: 'grid', value: 'Metrics' })} />);
    expect(document.querySelector('.NodeContent-grid')).not.toBeNull();
    expect(screen.getByText('Metrics')).toBeTruthy();
  });

  it('renders plain text for a non-media node', () => {
    render(<NodeContent item={makeItem({ type: 'note', value: 'hello world' })} />);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.NodeContent-file')).toBeNull();
    expect(screen.getByText('hello world')).toBeTruthy();
  });

  it('treats synthetic nodes as text even when typed image', () => {
    render(<NodeContent item={makeItem({ type: 'image', value: PNG, _synthetic: true })} />);
    expect(document.querySelector('img')).toBeNull();
  });
});
