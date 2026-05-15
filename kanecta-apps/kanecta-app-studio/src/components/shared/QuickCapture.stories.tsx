import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QuickCapture } from './QuickCapture';

const meta: Meta<typeof QuickCapture> = {
  component: QuickCapture,
  title: 'Shared/QuickCapture',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof QuickCapture>;

function QuickCaptureDemo() {
  const [open, setOpen] = useState(true);
  const [last, setLast] = useState<string>();
  return (
    <div style={{ height: '100vh', background: '#f5f5f5' }}>
      <button onClick={() => setOpen(true)}>Open Quick Capture</button>
      {last && <p>Last captured: {last}</p>}
      <QuickCapture
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={(v) => { setLast(v); setOpen(false); }}
      />
    </div>
  );
}

export const Default: Story = { render: () => <QuickCaptureDemo /> };
export const Closed: Story = {
  args: { open: false, onClose: () => {}, onSubmit: () => {} },
};
