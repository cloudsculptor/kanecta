import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { DiagramView as DiagramViewPkg } from '@kanecta/component-diagram-view';

export const DiagramViewMeta: ViewMeta = {
  uuid: 'a0f9b8c7-d1e2-4f3a-4b5c-6d7e8f9a0b1c',
  name: 'diagram',
  label: 'Diagram',
  icon: 'Schema',
};

export function DiagramView() {
  useViewLocation(DiagramViewMeta.uuid);
  return <DiagramViewPkg />;
}
