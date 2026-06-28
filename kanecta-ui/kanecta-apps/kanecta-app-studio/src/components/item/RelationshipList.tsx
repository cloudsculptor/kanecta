import { useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '../../store/workspace';
import { useUiStore } from '../../store/ui';
import type { Relationship } from '../../types/kanecta';
import './RelationshipList.scss';

interface RelationshipListProps {
  itemId: string;
}

function RelRow({ rel, currentId }: { rel: Relationship; currentId: string }) {
  const { setFocusedItem } = useUiStore();
  const otherId = rel.fromId === currentId ? rel.toId : rel.fromId;
  const direction = rel.fromId === currentId ? '→' : '←';

  return (
    <div className="RelationshipList-item" onClick={() => setFocusedItem(otherId)}>
      <span className="RelationshipList-type">{direction} {rel.type.replace(/_/g, ' ')}</span>
      <span className="RelationshipList-value" title={otherId}>{otherId}</span>
    </div>
  );
}

export function RelationshipList({ itemId }: RelationshipListProps) {
  const { getApi } = useWorkspaceStore();
  const { data: rels = [], isLoading } = useQuery({
    queryKey: ['relationships', itemId],
    queryFn: () => getApi().items.relationships(itemId),
    enabled: !!itemId,
  });

  if (isLoading) return <div className="RelationshipList-empty">Loading…</div>;
  if (rels.length === 0) return <div className="RelationshipList-empty">No relationships</div>;

  return (
    <div className="RelationshipList">
      {rels.map((rel) => (
        <RelRow key={rel.id} rel={rel} currentId={itemId} />
      ))}
    </div>
  );
}
