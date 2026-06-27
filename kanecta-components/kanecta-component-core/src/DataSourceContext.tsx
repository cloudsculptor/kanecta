import { createContext, useContext } from 'react';
import type { DataSource } from './DataSource.js';

const DataSourceContext = createContext<DataSource | null>(null);

export function DataSourceProvider({
  api,
  children,
}: {
  api: DataSource;
  children: React.ReactNode;
}) {
  return (
    <DataSourceContext.Provider value={api}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource(): DataSource {
  const ctx = useContext(DataSourceContext);
  if (!ctx) {
    throw new Error('useDataSource must be used inside a DataSourceProvider');
  }
  return ctx;
}
