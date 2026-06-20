import { AccountMenu } from './AccountMenu';
import './Corners.scss';

export function TopRightCorner() {
  return (
    <nav className="TopRightCorner">
      <AccountMenu />
    </nav>
  );
}
