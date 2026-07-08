import { useCallback } from 'react';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import {
  IntegrityView as IntegrityViewPkg,
  type IntegrityEvent,
  type IntegrityRunner,
} from '@kanecta/component-integrity-view';
import { useWorkingSetStore } from '../../../store/workingSet';

export const IntegrityViewMeta: ViewMeta = {
  uuid: 'a7d3c1e0-4b52-4f8a-9c1d-2e6f0a4b8c31',
  name: 'integrity',
  label: 'Integrity',
  icon: 'HealthAndSafety',
};

export function IntegrityView() {
  useViewLocation(IntegrityViewMeta.uuid);
  const { getApi } = useWorkingSetStore();
  const api = getApi();

  // Adapt the API's SSE stream to the package's runner contract. Mirrors the
  // Claude view's EventSource wiring.
  const run: IntegrityRunner = useCallback(
    ({ onEvent, signal }) =>
      new Promise<void>((resolve, reject) => {
        const es = new EventSource(api.integrity.streamUrl());
        const finish = () => { es.close(); resolve(); };
        signal.addEventListener('abort', finish);
        es.onmessage = (e) => {
          let ev: IntegrityEvent;
          try { ev = JSON.parse(e.data); } catch { return; }
          onEvent(ev);
          if (ev.type === 'done' || ev.type === 'error') finish();
        };
        es.onerror = () => {
          es.close();
          if (!signal.aborted) reject(new Error('Integrity stream failed'));
          else resolve();
        };
      }),
    [api],
  );

  return <IntegrityViewPkg run={run} />;
}
