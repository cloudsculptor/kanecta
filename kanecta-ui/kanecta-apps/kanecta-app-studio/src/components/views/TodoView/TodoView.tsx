import { TodoView as TodoViewComponent } from '@kanecta/component-todo-view';
import { DataSourceProvider } from '@kanecta/component-core';
import { useLocation } from '../../../context/LocationContext';
import { useWorkspaceStore } from '../../../store/workspace';
import { createStudioDataSource } from '../../../lib/StudioDataSource';

export function TodoView() {
  const { itemId } = useLocation();
  const { getApi } = useWorkspaceStore();
  const ds = createStudioDataSource(getApi());
  return (
    <DataSourceProvider api={ds}>
      <TodoViewComponent itemId={itemId} />
    </DataSourceProvider>
  );
}
