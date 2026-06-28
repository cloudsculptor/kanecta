import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { KanectaItem } from '../../types/kanecta';
import './MentionDropdown.scss';

export interface MentionDropdownHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface MentionDropdownProps {
  items: KanectaItem[];
  command: (item: KanectaItem) => void;
}

export const MentionDropdown = forwardRef<MentionDropdownHandle, MentionDropdownProps>(
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

    if (!items.length) {
      return (
        <div className="MentionDropdown">
          <div className="MentionDropdown-empty">No items found</div>
        </div>
      );
    }

    return (
      <div className="MentionDropdown">
        {items.map((item, index) => (
          <button
            key={item.id}
            className={`MentionDropdown-item${index === selectedIndex ? ' MentionDropdown-item--selected' : ''}`}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="MentionDropdown-item-type">{item.type}</span>
            <span className="MentionDropdown-item-value">{item.value}</span>
          </button>
        ))}
      </div>
    );
  },
);

MentionDropdown.displayName = 'MentionDropdown';
