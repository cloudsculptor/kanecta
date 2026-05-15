import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ItemMetadata } from './ItemMetadata';
import { AnnotationThread } from './AnnotationThread';
import { RelationshipList } from './RelationshipList';
import { BacklinkList } from './BacklinkList';
import { HistoryTimeline } from './HistoryTimeline';
import { BlockEditor } from '../editor/BlockEditor';
import { useWorkspaceStore } from '../../store/workspace';
import './ItemDetail.scss';

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ItemDetail-section">
      <div className="ItemDetail-section-header" onClick={() => setOpen((o) => !o)}>
        <h3>{title}</h3>
        <span className="ItemDetail-section-header-toggle">{open ? '▾' : '▸'}</span>
      </div>
      {open && children}
    </div>
  );
}

interface ItemDetailProps {
  itemId: string;
}

export function ItemDetail({ itemId }: ItemDetailProps) {
  const { getApi } = useWorkspaceStore();

  const { data: item, isLoading } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => getApi().items.get(itemId),
    enabled: !!itemId,
  });

  if (isLoading) return <div className="ItemDetail-loading">Loading…</div>;
  if (!item) return <div className="ItemDetail-loading">Item not found</div>;

  return (
    <div className="ItemDetail">
      <Section title="Properties">
        <ItemMetadata item={item} />
      </Section>
      {item.type === 'text' && (
        <Section title="Content">
          <BlockEditor itemId={item.id} initialContent={item.value} />
        </Section>
      )}
      <Section title="Annotations" defaultOpen={false}>
        <AnnotationThread itemId={itemId} />
      </Section>
      <Section title="Relationships" defaultOpen={false}>
        <RelationshipList itemId={itemId} />
      </Section>
      <Section title="Backlinks" defaultOpen={false}>
        <BacklinkList itemId={itemId} />
      </Section>
      <Section title="History" defaultOpen={false}>
        <HistoryTimeline itemId={itemId} />
      </Section>
    </div>
  );
}
