import { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface LocationState {
  viewId: string | null;
  itemId: string | null;
  setViewId: (id: string | null) => void;
  setItemId: (id: string | null) => void;
}

const LocationContext = createContext<LocationState>({
  viewId: null,
  itemId: null,
  setViewId: () => {},
  setItemId: () => {},
});

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [viewId, setViewId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);

  const stableSetViewId = useCallback((id: string | null) => setViewId(id), []);
  const stableSetItemId = useCallback((id: string | null) => setItemId(id), []);

  return (
    <LocationContext.Provider value={{ viewId, itemId, setViewId: stableSetViewId, setItemId: stableSetItemId }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  return useContext(LocationContext);
}

export function useViewLocation(uuid: string) {
  const { setViewId, setItemId } = useLocation();
  useEffect(() => {
    setViewId(uuid);
    return () => {
      setViewId(null);
      setItemId(null);
    };
  }, [uuid, setViewId, setItemId]);
  return { setItemId };
}
