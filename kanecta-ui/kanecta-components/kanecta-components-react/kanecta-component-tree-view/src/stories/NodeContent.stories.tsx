import type { Meta, StoryObj } from '@storybook/react';
import { within, expect } from 'storybook/test';
import { NodeContent } from '../components/NodeContent';
import type { KanectaItem } from '../types';

// A 1×1 transparent PNG — a self-contained image source with no network.
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function item(partial: Partial<KanectaItem>): KanectaItem {
  return { id: 'x', value: '', type: 'text', sortOrder: 0, tags: [], createdAt: null, modifiedAt: null, ...partial };
}

const meta: Meta<typeof NodeContent> = {
  component: NodeContent,
  title: 'Views/NodeContent',
  decorators: [(Story) => <div style={{ padding: 16 }}><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof NodeContent>;

export const Image: Story = {
  args: { item: item({ type: 'image', value: PNG_1x1 }) },
  play: async ({ canvasElement }) => {
    const img = canvasElement.querySelector('img.NodeContent-image');
    await expect(img).toBeTruthy();
    await expect(img).toHaveAttribute('src', PNG_1x1);
  },
};

export const ImageFromUrl: Story = {
  args: { item: item({ type: 'image', value: 'https://placehold.co/80x60/png' }) },
};

export const ImageWithHostResolver: Story = {
  args: {
    item: item({ type: 'image', value: 'stored-photo' }),   // value is NOT a URL
    resolveMediaUrl: () => PNG_1x1,                          // host supplies the bytes
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img.NodeContent-image')).toHaveAttribute('src', PNG_1x1);
  },
};

export const ImageWithoutSourceFallsBackToText: Story = {
  args: { item: item({ type: 'image', value: 'my-photo' }) },   // not a URL, no resolver
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img')).toBeNull();
    await expect(within(canvasElement).getByText('my-photo')).toBeInTheDocument();
  },
};

export const File: Story = {
  args: { item: item({ type: 'file', value: '/files/report.pdf' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('report.pdf')).toBeInTheDocument();
    const link = canvasElement.querySelector('a.NodeContent-file-download');
    await expect(link).toHaveAttribute('download', 'report.pdf');
  },
};

// A `file` item whose sidecar role map carries `image` renders the picture
// itself (spec §files-and-sidecars) — the host resolver supplies the bytes URL.
export const FileWithImageRole: Story = {
  args: {
    item: item({ type: 'file', value: 'holiday.png', files: { image: 'holiday.png' } }),
    resolveMediaUrl: () => PNG_1x1,
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img.NodeContent-image')).toHaveAttribute('src', PNG_1x1);
    await expect(canvasElement.querySelector('.NodeContent-file')).toBeNull();
  },
};

export const FileWithImageRoleNoResolver: Story = {
  args: { item: item({ type: 'file', value: 'holiday.png', files: { image: 'holiday.png' } }) },
  play: async ({ canvasElement }) => {
    // Without a bytes URL the image role degrades to the ordinary file row.
    await expect(canvasElement.querySelector('img')).toBeNull();
    await expect(within(canvasElement).getByText('holiday.png')).toBeInTheDocument();
  },
};

export const FileNoDownloadUrl: Story = {
  args: { item: item({ type: 'file', value: 'notes.txt' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('notes.txt')).toBeInTheDocument();
    await expect(canvasElement.querySelector('a.NodeContent-file-download')).toBeNull();
  },
};

// With a fetchFileBytes host the file row itself is the download trigger,
// guarded by a confirmation dialog (bytes come from datastore file storage).
export const FileClickToDownload: Story = {
  args: {
    item: item({ type: 'file', value: 'Quarterly report', files: { file: 'report.pdf' } }),
    fetchFileBytes: async () => new Blob(['pdf bytes']),
  },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector('.NodeContent-file--downloadable');
    await expect(row).toBeTruthy();
    await expect(row).toHaveAttribute('role', 'button');
  },
};

// Images with a bytes host grow a hover download overlay — no dialog.
export const ImageWithDownloadOverlay: Story = {
  args: {
    item: item({ type: 'file', value: 'holiday.png', files: { image: 'holiday.png' } }),
    resolveMediaUrl: () => PNG_1x1,
    fetchFileBytes: async () => new Blob(['png bytes']),
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img.NodeContent-image')).toBeTruthy();
    await expect(canvasElement.querySelector('.NodeContent-image-download')).toBeTruthy();
  },
};

export const Grid: Story = {
  args: { item: item({ type: 'grid', value: 'Quarterly metrics' }) },
};

export const Text: Story = {
  args: { item: item({ type: 'note', value: 'Just **text** with a `code` span' }) },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img')).toBeNull();
    await expect(canvasElement.querySelector('.NodeContent-file')).toBeNull();
  },
};

// ── Symlinks — the target renders through its own type's renderer, marked by
// a green bullet (spec: a symlink's value holds the target item's UUID).

const LINK_TARGET_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

export const SymlinkToText: Story = {
  args: {
    item: item({ type: 'symlink', value: LINK_TARGET_ID }),
    resolveId: (id) =>
      id === LINK_TARGET_ID ? item({ id, value: 'The linked item' }) : undefined,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('The linked item')).toBeInTheDocument();
    const bullet = canvasElement.querySelector('.NodeContent-symlink-bullet');
    await expect(bullet).toBeTruthy();
    await expect(bullet).not.toHaveClass('is-broken');
  },
};

export const SymlinkToImage: Story = {
  args: {
    item: item({ type: 'symlink', value: LINK_TARGET_ID }),
    resolveId: (id) =>
      id === LINK_TARGET_ID ? item({ id, type: 'image', value: PNG_1x1 }) : undefined,
  },
  play: async ({ canvasElement }) => {
    // Universal dispatch: the symlink renders its target's renderer — an <img>.
    await expect(canvasElement.querySelector('img.NodeContent-image')).toHaveAttribute('src', PNG_1x1);
    await expect(canvasElement.querySelector('.NodeContent-symlink-bullet')).toBeTruthy();
  },
};

export const SymlinkToFileImage: Story = {
  args: {
    item: item({ type: 'symlink', value: LINK_TARGET_ID }),
    resolveId: (id) =>
      id === LINK_TARGET_ID
        ? item({ id, type: 'file', value: 'holiday.png', files: { image: 'holiday.png' } })
        : undefined,
    resolveMediaUrl: (i) => (i.id === LINK_TARGET_ID ? PNG_1x1 : undefined),
  },
  play: async ({ canvasElement }) => {
    // The symlink renders its file target's own renderer — the inline image.
    await expect(canvasElement.querySelector('img.NodeContent-image')).toHaveAttribute('src', PNG_1x1);
    await expect(canvasElement.querySelector('.NodeContent-symlink-bullet')).toBeTruthy();
  },
};

export const SymlinkNonUuidFallsBackToText: Story = {
  args: { item: item({ type: 'symlink', value: 'not-a-uuid' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('not-a-uuid')).toBeInTheDocument();
    await expect(canvasElement.querySelector('.NodeContent-symlink')).toBeNull();
  },
};
