import { useQuery } from '@tanstack/react-query';
import LinkIcon from '@mui/icons-material/Link';
import { useWorkingSetStore } from '../../store/workingSet';
import { useUiStore } from '../../store/ui';
import './BacklinkList.scss';

interface BacklinkListProps {
  itemId: string;
}

export function BacklinkList({ itemId }: BacklinkListProps) {
  const { getApi } = useWorkingSetStore();
  const { setFocusedItem } = useUiStore();

  const { data: backlinks = [], isLoading } = useQuery({
    queryKey: ['backlinks', itemId],
    queryFn: () => getApi().items.backlinks(itemId),
    enabled: !!itemId,
  });

  if (isLoading) return <div className="BacklinkList-empty">Loading…</div>;
  if (backlinks.length === 0) return <div className="BacklinkList-empty">No backlinks</div>;

  return (
    <div className="BacklinkList">
      {backlinks.map((item) => (
        <div
          key={item.id}
          className="BacklinkList-item"
          onClick={() => setFocusedItem(item.id)}
        >
          <LinkIcon className="BacklinkList-icon" sx={{ fontSize: 14 }} />
          <span className="BacklinkList-value" title={item.value}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
