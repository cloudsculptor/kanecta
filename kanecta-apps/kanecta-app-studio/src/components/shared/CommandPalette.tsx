import { useEffect, useRef, useState } from 'react';
import SearchIcon from '@mui/icons-material/Search';
import ArticleIcon from '@mui/icons-material/Article';
import type { KanectaItem } from '../../types/kanecta';
import './CommandPalette.scss';

export interface Command {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: KanectaItem[];
  commands: Command[];
  onSelectItem: (item: KanectaItem) => void;
}

export function CommandPalette({
  open,
  onClose,
  items,
  commands,
  onSelectItem,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('');
      setFocusedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.toLowerCase();
  const matchedItems = q
    ? items.filter((i) => i.value.toLowerCase().includes(q)).slice(0, 8)
    : [];
  const matchedCommands = commands.filter((c) => c.label.toLowerCase().includes(q));

  const allResults: { type: 'item' | 'command'; value: KanectaItem | Command }[] = [
    ...matchedItems.map((i) => ({ type: 'item' as const, value: i })),
    ...matchedCommands.map((c) => ({ type: 'command' as const, value: c })),
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const result = allResults[focusedIndex];
      if (result) {
        if (result.type === 'item') onSelectItem(result.value as KanectaItem);
        else (result.value as Command).onSelect();
        onClose();
      }
    }
  };

  return (
    <div className="CommandPalette" role="dialog" aria-modal aria-label="Command palette">
      <div className="CommandPalette-backdrop" onClick={onClose} />
      <div className="CommandPalette-dialog">
        <div className="CommandPalette-search">
          <SearchIcon className="CommandPalette-search-icon" fontSize="small" />
          <input
            ref={inputRef}
            className="CommandPalette-search-input"
            placeholder="Search items or type a command…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocusedIndex(0); }}
            onKeyDown={handleKeyDown}
            aria-label="Search"
          />
        </div>
        <div className="CommandPalette-results" role="listbox">
          {allResults.length === 0 && query && (
            <div className="CommandPalette-empty">No results for "{query}"</div>
          )}
          {allResults.length === 0 && !query && (
            <div className="CommandPalette-empty">Start typing to search…</div>
          )}
          {matchedItems.length > 0 && (
            <>
              <div className="CommandPalette-group-label">Items</div>
              {matchedItems.map((item, i) => (
                <button
                  key={item.id}
                  className={`CommandPalette-item${focusedIndex === i ? ' CommandPalette-item--focused' : ''}`}
                  role="option"
                  aria-selected={focusedIndex === i}
                  onClick={() => { onSelectItem(item); onClose(); }}
                >
                  <ArticleIcon className="CommandPalette-item-icon" fontSize="small" />
                  <span className="CommandPalette-item-label">{item.value}</span>
                  <span className="CommandPalette-item-meta">{item.type}</span>
                </button>
              ))}
            </>
          )}
          {matchedCommands.length > 0 && (
            <>
              <div className="CommandPalette-group-label">Commands</div>
              {matchedCommands.map((cmd, i) => {
                const idx = matchedItems.length + i;
                return (
                  <button
                    key={cmd.id}
                    className={`CommandPalette-item${focusedIndex === idx ? ' CommandPalette-item--focused' : ''}`}
                    role="option"
                    aria-selected={focusedIndex === idx}
                    onClick={() => { cmd.onSelect(); onClose(); }}
                  >
                    <span className="CommandPalette-item-icon">{cmd.icon}</span>
                    <span className="CommandPalette-item-label">{cmd.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
