import './Breadcrumb.scss';

export interface BreadcrumbItem {
  id: string;
  label: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate?: (id: string) => void;
}

export function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav className="Breadcrumb" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isCurrent = i === items.length - 1;
        return (
          <span key={item.id} className="Breadcrumb-fragment">
            {i > 0 && <span className="Breadcrumb-sep" aria-hidden>›</span>}
            <button
              className={`Breadcrumb-item${isCurrent ? ' Breadcrumb-item--current' : ''}`}
              onClick={() => !isCurrent && onNavigate?.(item.id)}
              aria-current={isCurrent ? 'page' : undefined}
              disabled={isCurrent}
            >
              {item.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
