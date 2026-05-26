import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import AddIcon from '@mui/icons-material/Add';
import { CommandPalette } from './CommandPalette';
import type { KanectaItem } from '../../types/kanecta';

const MOCK_ITEMS: KanectaItem[] = [
  { id: '1', value: 'The nature of consciousness', type: 'concept', confidence: 'high', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' },
  { id: '2', value: 'Quantum entanglement basics', type: 'note', confidence: 'verified', sortOrder: 1, tags: [], createdAt: '', modifiedAt: '' },
  { id: '3', value: 'Read Gödel Escher Bach', type: 'task', confidence: 'medium', sortOrder: 2, tags: [], createdAt: '', modifiedAt: '' },
];

const MOCK_COMMANDS = [
  { id: 'new-panel', label: 'Add new panel', icon: <AddIcon fontSize="small" />, onSelect: () => alert('add panel') },
  { id: 'rebuild', label: 'Rebuild indexes', icon: <AddIcon fontSize="small" />, onSelect: () => alert('rebuild') },
];

const meta: Meta<typeof CommandPalette> = {
  component: CommandPalette,
  title: 'Shared/CommandPalette',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof CommandPalette>;

function Demo() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ height: '100vh', background: '#f5f5f5' }}>
      <button onClick={() => setOpen(true)}>Open Command Palette</button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        items={MOCK_ITEMS}
        commands={MOCK_COMMANDS}
        onSelectItem={(item) => alert(`Selected: ${item.value}`)}
      />
    </div>
  );
}

export const Default: Story = { render: () => <Demo /> };
export const Closed: Story = {
  args: { open: false, onClose: () => {}, items: [], commands: [], onSelectItem: () => {} },
};
