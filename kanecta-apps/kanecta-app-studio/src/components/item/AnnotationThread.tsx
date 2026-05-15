import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnnotationComposer } from './AnnotationComposer';
import { useWorkspaceStore } from '../../store/workspace';
import type { Annotation } from '../../types/kanecta';
import './AnnotationThread.scss';

interface AnnotationThreadProps {
  itemId: string;
}

function formatAge(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

interface AnnotationNodeProps {
  annotation: Annotation;
  itemId: string;
  depth: number;
}

function AnnotationNode({ annotation, itemId, depth }: AnnotationNodeProps) {
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);

  const addMutation = useMutation({
    mutationFn: (content: string) =>
      getApi().items.annotate(itemId, { value: content, parentAnnotationId: annotation.id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['annotations', itemId] }),
  });

  return (
    <div className="AnnotationThread-annotation">
      <div className="AnnotationThread-annotation-content">{annotation.value}</div>
      <div className="AnnotationThread-annotation-meta">
        <span>{formatAge(annotation.createdAt)}</span>
        {depth < 3 && (
          <button className="AnnotationThread-reply-btn" onClick={() => setReplying((r) => !r)}>
            {replying ? 'cancel' : 'reply'}
          </button>
        )}
      </div>
      {annotation.replies?.length ? (
        <div className="AnnotationThread-replies">
          {annotation.replies.map((r) => (
            <AnnotationNode key={r.id} annotation={r} itemId={itemId} depth={depth + 1} />
          ))}
        </div>
      ) : null}
      {replying && (
        <div className="AnnotationThread-reply-composer">
          <AnnotationComposer
            replyingTo={annotation.id}
            onCancelReply={() => setReplying(false)}
            onSubmit={(content) => { addMutation.mutate(content); setReplying(false); }}
          />
        </div>
      )}
    </div>
  );
}

export function AnnotationThread({ itemId }: AnnotationThreadProps) {
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();

  const { data: annotations = [], isLoading } = useQuery({
    queryKey: ['annotations', itemId],
    queryFn: () => getApi().items.annotations(itemId),
    enabled: !!itemId,
  });

  const addMutation = useMutation({
    mutationFn: (content: string) =>
      getApi().items.annotate(itemId, { value: content }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['annotations', itemId] }),
  });

  if (isLoading) return <div className="AnnotationThread-empty">Loading…</div>;

  return (
    <div className="AnnotationThread">
      {annotations.length === 0 && (
        <div className="AnnotationThread-empty">No annotations yet</div>
      )}
      {annotations.map((a) => (
        <AnnotationNode key={a.id} annotation={a} itemId={itemId} depth={0} />
      ))}
      <AnnotationComposer onSubmit={(c) => addMutation.mutate(c)} />
    </div>
  );
}
