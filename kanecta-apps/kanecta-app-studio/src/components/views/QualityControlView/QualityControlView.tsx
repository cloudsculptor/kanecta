import { useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '../../../store/workspace';
import './QualityControlView.scss';

export function QualityControlView() {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const api = getApi();

  const { data, isLoading, error } = useQuery({
    queryKey: ['items-stats', activeWorkspaceId],
    queryFn: () => api.items.stats(),
  });

  if (isLoading) return <div className="QualityControlView"><div className="QualityControlView-loading">Loading…</div></div>;
  if (error || !data) return <div className="QualityControlView"><div className="QualityControlView-error">Failed to load stats</div></div>;

  const { total, typedCount, typeCounts } = data;
  const percentage = total > 0 ? Math.round((typedCount / total) * 100) : 0;

  const rows = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="QualityControlView">
      <div className="QualityControlView-panel">
        <div className="QualityControlView-label">Data quality</div>
        <div className="QualityControlView-percentage">{percentage}%</div>
        <div className="QualityControlView-fraction">{typedCount} / {total}</div>

        <table className="QualityControlView-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([type, count]) => (
              <tr key={type}>
                <td>{type}</td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
