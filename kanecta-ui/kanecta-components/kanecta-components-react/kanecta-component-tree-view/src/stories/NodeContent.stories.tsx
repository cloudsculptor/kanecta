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

export const FileNoDownloadUrl: Story = {
  args: { item: item({ type: 'file', value: 'notes.txt' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('notes.txt')).toBeInTheDocument();
    await expect(canvasElement.querySelector('a.NodeContent-file-download')).toBeNull();
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
