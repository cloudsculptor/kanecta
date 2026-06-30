import { TodoView as TodoViewComponent } from '@kanecta/component-todo-view';
import { DataSourceProvider } from '@kanecta/component-core';
import { useLocation } from '../../../context/LocationContext';
import { useWorkingSetStore } from '../../../store/workingSet';
import { createStudioDataSource } from '../../../lib/StudioDataSource';

export function TodoView() {
  const { itemId } = useLocation();
  const { getApi } = useWorkingSetStore();
  const ds = createStudioDataSource(getApi());
  return (
    <DataSourceProvider api={ds}>
      <TodoViewComponent itemId={itemId} />
    </DataSourceProvider>
  );
}
