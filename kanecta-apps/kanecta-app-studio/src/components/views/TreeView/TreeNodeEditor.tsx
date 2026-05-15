import { useEffect, useRef } from 'react';
import './TreeNodeEditor.scss';

interface TreeNodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onAbort: () => void;
  onEnter: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onDeleteEmpty: () => void;
}

export function TreeNodeEditor({
  value,
  onChange,
  onCommit,
  onAbort,
  onEnter,
  onIndent,
  onOutdent,
  onDeleteEmpty,
}: TreeNodeEditorProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
  }, []);

  return (
    <input
      ref={ref}
      className="TreeNodeEditor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) onOutdent();
          else onIndent();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onAbort();
        } else if (e.key === 'Backspace' && value === '') {
          e.preventDefault();
          onDeleteEmpty();
        }
      }}
    />
  );
}
