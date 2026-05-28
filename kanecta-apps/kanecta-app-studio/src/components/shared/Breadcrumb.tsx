import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import './Breadcrumb.scss';

export interface BreadcrumbItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
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
            {i > 0 && (
              <span className="Breadcrumb-sep" aria-hidden>
                <ChevronRightIcon sx={{ fontSize: '18px', width: '18px', height: '18px' }} />
              </span>
            )}
            <button
              className={`Breadcrumb-item${isCurrent ? ' Breadcrumb-item--current' : ''}${item.icon ? ' Breadcrumb-item--icon' : ''}`}
              onClick={() => !isCurrent && onNavigate?.(item.id)}
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={item.icon ? item.label : undefined}
              disabled={isCurrent}
            >
              {item.icon ?? item.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
