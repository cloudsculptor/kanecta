import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { useQuery } from '@tanstack/react-query';

export const QualityControlViewMeta: ViewMeta = {
  uuid: 'f3e2a1b0-c4d5-4e6f-7a8b-9c0d1e2f3a4b',
  name: 'quality-control',
  label: 'Quality',
  icon: 'FactCheck',
};
import { useWorkspaceStore } from '../../../store/workspace';
import { DynamicIcon } from '../../shared/DynamicIcon';
import { TYPE_ICONS } from '../../../lib/typeIcons';
import './QualityControlView.scss';

export function QualityControlView() {
  useViewLocation(QualityControlViewMeta.uuid);
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const api = getApi();

  const { data, isLoading, error } = useQuery({
    queryKey: ['items-stats', activeWorkspaceId],
    queryFn: () => api.items.stats(),
  });

  if (isLoading) return <div className="QualityControlView"><div className="QualityControlView-loading">Loading…</div></div>;
  if (error || !data) return <div className="QualityControlView"><div className="QualityControlView-error">Failed to load stats</div></div>;

  const { total, typedCount, structured, unstructured } = data;
  const percentage = total > 0 ? Math.round((typedCount / total) * 100) : 0;

  return (
    <div className="QualityControlView">
      <div className="QualityControlView-panel">
        <div className="QualityControlView-label">Data quality</div>
        <div className="QualityControlView-percentage">{percentage}%</div>
        <div className="QualityControlView-fraction">{typedCount} / {total}</div>

        {unstructured.length > 0 && (
          <>
            <div className="QualityControlView-section-heading">Primitive / Unstructured</div>
            <table className="QualityControlView-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {unstructured.map(({ type, count }) => {
                  const Icon = TYPE_ICONS[type as keyof typeof TYPE_ICONS];
                  return (
                    <tr key={type}>
                      <td>
                        <span className="QualityControlView-type-cell">
                          {Icon && <Icon className="QualityControlView-type-icon" />}
                          {type}
                        </span>
                      </td>
                      <td>{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {structured.length > 0 && (
          <>
            <div className="QualityControlView-section-heading">Templated / Structured</div>
            <table className="QualityControlView-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {structured.map(({ typeId, name, icon, count }) => (
                  <tr key={typeId}>
                    <td>
                      <span className="QualityControlView-type-cell">
                        {icon
                          ? <DynamicIcon name={icon} className="QualityControlView-type-icon" />
                          : (() => { const Icon = TYPE_ICONS['object']; return Icon ? <Icon className="QualityControlView-type-icon" /> : null; })()
                        }
                        {name}
                      </span>
                    </td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
