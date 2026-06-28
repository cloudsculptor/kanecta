import { useState } from 'react';
import { Button } from '@mui/material';
import './AnnotationComposer.scss';

interface AnnotationComposerProps {
  onSubmit: (content: string) => void;
  replyingTo?: string;
  onCancelReply?: () => void;
}

export function AnnotationComposer({ onSubmit, replyingTo, onCancelReply }: AnnotationComposerProps) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  };

  return (
    <div className="AnnotationComposer">
      {replyingTo && (
        <div className="AnnotationComposer-reply-label">
          Replying to annotation ·{' '}
          <button
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-primary)', padding: 0, fontSize: 'inherit' }}
            onClick={onCancelReply}
          >
            cancel
          </button>
        </div>
      )}
      <textarea
        className="AnnotationComposer-textarea"
        placeholder="Add an annotation…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) handleSubmit();
        }}
        aria-label="Annotation text"
      />
      <div className="AnnotationComposer-footer">
        <Button size="small" variant="contained" onClick={handleSubmit} disabled={!value.trim()}>
          Add annotation
        </Button>
      </div>
    </div>
  );
}
