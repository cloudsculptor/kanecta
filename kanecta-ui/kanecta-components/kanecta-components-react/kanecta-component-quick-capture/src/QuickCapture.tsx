import { useEffect, useRef, useState } from 'react';
import { Button } from '@mui/material';
import './QuickCapture.scss';

export interface QuickCaptureProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export function QuickCapture({ open, onClose, onSubmit }: QuickCaptureProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
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

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
      onClose();
    }
  };

  return (
    <div className="QuickCapture" role="dialog" aria-modal aria-label="Quick capture">
      <div className="QuickCapture__backdrop" onClick={onClose} />
      <div className="QuickCapture__dialog">
        <span className="QuickCapture__label">Quick capture</span>
        <input
          ref={inputRef}
          className="QuickCapture__input"
          placeholder="Capture a note, task, idea…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
          aria-label="Item value"
        />
        <div className="QuickCapture__footer">
          <Button size="small" onClick={onClose}>Cancel</Button>
          <Button size="small" variant="contained" onClick={handleSubmit} disabled={!value.trim()}>
            Capture
          </Button>
        </div>
      </div>
    </div>
  );
}
