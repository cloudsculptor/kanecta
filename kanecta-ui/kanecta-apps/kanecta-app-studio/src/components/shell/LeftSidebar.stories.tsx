import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { LeftSidebar } from './LeftSidebar';
import type { SidebarState, ViewType } from '../../types/ui';

const meta: Meta<typeof LeftSidebar> = {
  component: LeftSidebar,
  title: 'Shell/LeftSidebar',
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: '100vh', display: 'flex' }}><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof LeftSidebar>;

function Demo({ initialState }: { initialState: SidebarState }) {
  const [state, setState] = useState<SidebarState>(initialState);
  const [view, setView] = useState<ViewType>('tree');
  return (
    <LeftSidebar
      state={state}
      activeView={view}
      onViewSelect={setView}
      onToggle={() => setState(state === 'expanded' ? 'icons' : 'expanded')}
    />
  );
}

export const Icons: Story = { render: () => <Demo initialState="icons" /> };
export const Expanded: Story = { render: () => <Demo initialState="expanded" /> };
export const Collapsed: Story = { render: () => <Demo initialState="collapsed" /> };
