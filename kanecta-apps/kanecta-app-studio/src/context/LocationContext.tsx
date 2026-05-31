import { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface LocationState {
  viewId: string | null;
  itemId: string | null;
  overlayOpen: boolean;
  setViewId: (id: string | null) => void;
  setItemId: (id: string | null) => void;
  openOverlay: () => void;
  closeOverlay: () => void;
}

const LocationContext = createContext<LocationState>({
  viewId: null,
  itemId: null,
  overlayOpen: false,
  setViewId: () => {},
  setItemId: () => {},
  openOverlay: () => {},
  closeOverlay: () => {},
});

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [viewId, setViewId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const stableSetViewId = useCallback((id: string | null) => setViewId(id), []);
  const stableSetItemId = useCallback((id: string | null) => setItemId(id), []);
  const openOverlay = useCallback(() => setOverlayOpen(true), []);
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  return (
    <LocationContext.Provider value={{
      viewId, itemId, overlayOpen,
      setViewId: stableSetViewId,
      setItemId: stableSetItemId,
      openOverlay, closeOverlay,
    }}>
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
