import { DatastoreSwitcher } from './DatastoreSwitcher';
import './Corners.scss';

export function TopLeftCorner() {
  return (
    <div className="TopLeftCorner">
      <DatastoreSwitcher />
    </div>
  );
}
