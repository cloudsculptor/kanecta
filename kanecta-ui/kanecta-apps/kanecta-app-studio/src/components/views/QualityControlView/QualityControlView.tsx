import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { useQuery } from '@tanstack/react-query';
import { QualityControlView as QualityControlViewPkg } from '@kanecta/component-quality-control-view';
import { useWorkingSetStore } from '../../../store/workingSet';
import { TYPE_ICONS } from '../../../lib/typeIcons';

export const QualityControlViewMeta: ViewMeta = {
  uuid: 'f3e2a1b0-c4d5-4e6f-7a8b-9c0d1e2f3a4b',
  name: 'quality-control',
  label: 'Quality',
  icon: 'FactCheck',
};

export function QualityControlView() {
  useViewLocation(QualityControlViewMeta.uuid);
  const { getApi, activeWorkingSetId } = useWorkingSetStore();
  const api = getApi();

  const { data, isLoading, error } = useQuery({
    queryKey: ['items-stats', activeWorkingSetId],
    queryFn: () => api.items.stats(),
  });

  return (
    <QualityControlViewPkg
      stats={data ?? null}
      isLoading={isLoading}
      error={!!error}
      typeIcons={TYPE_ICONS as Record<string, React.ElementType<{ className?: string }>>}
    />
  );
}
