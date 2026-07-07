import './HomeView.scss';

export interface HomeNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

export interface HomeViewProps {
  items: HomeNavItem[];
  onNavigate: (id: string) => void;
}

export function HomeView({ items, onNavigate }: HomeViewProps) {
  return (
    <div className="HomeView">
      <div className="HomeView__grid">
        {items.map(({ id, label, icon, disabled }) => (
          <button
            key={id}
            className={['HomeView__item', disabled ? 'HomeView__item--disabled' : ''].filter(Boolean).join(' ')}
            onClick={() => !disabled && onNavigate(id)}
            aria-label={label}
            aria-disabled={disabled}
          >
            {icon}
            <span className="HomeView__item-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
