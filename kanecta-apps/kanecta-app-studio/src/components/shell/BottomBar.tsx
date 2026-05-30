import './BottomBar.scss';

interface BottomBarProps {
  onHome: () => void;
}

export function BottomBar({ onHome }: BottomBarProps) {
  return (
    <nav className="BottomBar">
      <button className="BottomBar-home" onClick={onHome} aria-label="Home">
        <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
      </button>
    </nav>
  );
}
