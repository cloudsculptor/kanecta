import './BottomBar.scss';

export function BottomBar() {
  return (
    <nav className="BottomBar">
      <img src="/logo.svg" alt="Kanecta" className="BottomBar-logo" />
      <span className="BottomBar-label">Kanecta</span>
    </nav>
  );
}
