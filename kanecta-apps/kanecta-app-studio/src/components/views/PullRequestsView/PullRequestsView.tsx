import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { PullRequestsView as PullRequestsViewPkg } from '@kanecta/component-pull-requests-view';

export const PullRequestsViewMeta: ViewMeta = {
  uuid: 'f3e2d1c0-b9a8-4f7e-6d5c-4b3a2f1e0d9c',
  name: 'pull-requests',
  label: 'Pull Requests',
  icon: 'AltRoute',
};

export function PullRequestsView() {
  useViewLocation(PullRequestsViewMeta.uuid);
  return <PullRequestsViewPkg />;
}
