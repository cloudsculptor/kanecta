import { DynamicIcon } from '@kanecta/component-dynamic-icon';
import './QualityControlView.scss';

export interface QualityControlStats {
  total: number;
  typedCount: number;
  unstructured: { type: string; count: number }[];
  structured: { typeId: string; name: string; icon?: string | null; count: number }[];
}

export interface QualityControlViewProps {
  stats?: QualityControlStats | null;
  isLoading?: boolean;
  error?: boolean;
  typeIcons?: Record<string, React.ElementType<{ className?: string }>>;
}

export function QualityControlView({ stats, isLoading, error, typeIcons = {} }: QualityControlViewProps) {
  if (isLoading) {
    return <div className="QualityControlView"><div className="QualityControlView__state">Loading…</div></div>;
  }
  if (error || !stats) {
    return <div className="QualityControlView"><div className="QualityControlView__state">Failed to load stats</div></div>;
  }

  const { total, typedCount, structured, unstructured } = stats;
  const percentage = total > 0 ? Math.round((typedCount / total) * 100) : 0;
  const unstructuredTotal = unstructured.reduce((s, r) => s + r.count, 0);
  const structuredTotal   = structured.reduce((s, r) => s + r.count, 0);

  return (
    <div className="QualityControlView">
      <div className="QualityControlView__col QualityControlView__col--overview">
        <div className="QualityControlView__label">Data quality</div>
        <div className="QualityControlView__percentage">{percentage}%</div>
        <div className="QualityControlView__fraction">{typedCount} / {total}</div>
      </div>

      <div className="QualityControlView__col">
        <div className="QualityControlView__col-heading">Primitive <span className="QualityControlView__col-count">{unstructuredTotal}</span></div>
        {unstructured.length === 0
          ? <div className="QualityControlView__empty">None</div>
          : (
            <table className="QualityControlView__table">
              <thead>
                <tr><th>Type</th><th>Count</th></tr>
              </thead>
              <tbody>
                {unstructured.map(({ type, count }) => {
                  const Icon = typeIcons[type];
                  return (
                    <tr key={type}>
                      <td>
                        <span className="QualityControlView__type-cell">
                          {Icon && <Icon className="QualityControlView__type-icon" />}
                          {type}
                        </span>
                      </td>
                      <td>{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
      </div>

      <div className="QualityControlView__col">
        <div className="QualityControlView__col-heading">Structured <span className="QualityControlView__col-count">{structuredTotal}</span></div>
        {structured.length === 0
          ? <div className="QualityControlView__empty">None</div>
          : (
            <table className="QualityControlView__table">
              <thead>
                <tr><th>Type</th><th>Count</th></tr>
              </thead>
              <tbody>
                {structured.map(({ typeId, name, icon, count }) => {
                  const FallbackIcon = typeIcons[typeId] ?? typeIcons['object'];
                  return (
                    <tr key={typeId}>
                      <td>
                        <span className="QualityControlView__type-cell">
                          {icon
                            ? <DynamicIcon name={icon} className="QualityControlView__type-icon" />
                            : FallbackIcon ? <FallbackIcon className="QualityControlView__type-icon" /> : null
                          }
                          {name}
                        </span>
                      </td>
                      <td>{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  );
}
