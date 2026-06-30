import { useQuery } from '@tanstack/react-query';
import { useWorkingSetStore } from '../../store/workingSet';
import './ItemDetail.scss';

interface ItemDetailProps {
  itemId: string;
}

export function ItemDetail({ itemId }: ItemDetailProps) {
  const { getApi } = useWorkingSetStore();

  const { data: doc, isLoading } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => getApi().items.get(itemId),
    enabled: !!itemId,
  });

  if (isLoading) return <div className="ItemDetail-loading">Loading…</div>;
  if (!doc) return <div className="ItemDetail-loading">Item not found</div>;

  return (
    <div className="ItemDetail">
      <pre className="ItemDetail-json">{JSON.stringify(doc, null, 2)}</pre>
    </div>
  );
}
