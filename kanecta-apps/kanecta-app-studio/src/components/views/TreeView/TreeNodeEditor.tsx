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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = value;
    el.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label="Edit item"
      aria-multiline="false"
      className="TreeNodeEditor"
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => onChange(e.currentTarget.textContent ?? '')}
      onBlur={onCommit}
      onKeyDown={(e) => {
        const empty = (e.currentTarget.textContent ?? '') === '';
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
        } else if (e.key === 'Backspace' && empty) {
          e.preventDefault();
          onDeleteEmpty();
        }
      }}
    />
  );
}
