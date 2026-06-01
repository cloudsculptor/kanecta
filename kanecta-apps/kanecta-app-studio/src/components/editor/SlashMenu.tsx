import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { ItemType } from '../../types/kanecta';
import { ITEM_TYPES } from '../../lib/constants';
import './SlashMenu.scss';

export interface SlashMenuItem {
  type: ItemType;
  label: string;
  description: string;
}

const SLASH_ITEMS: SlashMenuItem[] = ITEM_TYPES.map((type) => ({
  type,
  label: type.charAt(0).toUpperCase() + type.slice(1),
  description: slashDescription(type),
}));

function slashDescription(type: ItemType): string {
  const map: Record<ItemType, string> = {
    number: 'A numeric value',
    claim: 'An assertion to be evaluated',
    question: 'An open question to explore',
    task: 'An action item or to-do',
    note: 'A freeform note',
    concept: 'An abstract idea or concept',
    entity: 'A named real-world entity',
    event: 'A dated occurrence',
    text: 'A long-form text document',
    heading: 'A section heading',
    code: 'A code snippet',
    url: 'A web link',
    image: 'An image reference',
    file: 'A file attachment',
    object: 'A structured data object',
  };
  return map[type];
}

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashMenuProps {
  items: SlashMenuItem[];
  command: (item: SlashMenuItem) => void;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown({ key }: KeyboardEvent) {
        if (key === 'ArrowUp') {
          setSelectedIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        }
        if (key === 'ArrowDown') {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (key === 'Enter') {
          if (items[selectedIndex]) command(items[selectedIndex]);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) return null;

    return (
      <div className="SlashMenu">
        {items.map((item, index) => (
          <button
            key={item.type}
            className={`SlashMenu-item${index === selectedIndex ? ' SlashMenu-item--selected' : ''}`}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="SlashMenu-item-label">{item.label}</span>
            <span className="SlashMenu-item-description">{item.description}</span>
          </button>
        ))}
      </div>
    );
  },
);

SlashMenu.displayName = 'SlashMenu';

export { SLASH_ITEMS };
