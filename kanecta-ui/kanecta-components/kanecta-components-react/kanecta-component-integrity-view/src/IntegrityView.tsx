import { useCallback, useMemo, useRef, useState } from 'react';
import './IntegrityView.scss';

// Local mirror types for the integrity stream (kept in-package so the view has
// no dependency on @kanecta/api-client — the Studio wrapper wires the runner).

export type IntegrityStatus = 'pass' | 'fail' | 'skip';

export interface IntegrityFinding {
  severity: 'error' | 'warn';
  message: string;
  nodeId?: string;
  fix?: string;
  [extra: string]: unknown;
}

export interface IntegrityCheckResult {
  id: string;
  title: string;
  group: string;
  specRef: string;
  status: IntegrityStatus;
  findings: IntegrityFinding[];
  count: number;
  skipped?: string;
}

export interface IntegritySummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errorCount: number;
  warnCount: number;
  ok: boolean;
}

export type IntegrityCheckDescriptor = Pick<IntegrityCheckResult, 'id' | 'title' | 'group' | 'specRef'>;

export type IntegrityEvent =
  | { type: 'manifest'; total: number; checks: IntegrityCheckDescriptor[] }
  | { type: 'result'; index: number; result: IntegrityCheckResult }
  | { type: 'done'; summary: IntegritySummary }
  | { type: 'error'; error: string };

/**
 * Drives one integrity run. Calls `onEvent` for each streamed event and resolves
 * when the stream ends. `signal` aborts an in-flight run. The Studio wrapper
 * implements this against the API's SSE endpoint; stories pass a mock.
 */
export type IntegrityRunner = (handlers: { onEvent: (ev: IntegrityEvent) => void; signal: AbortSignal }) => Promise<void>;

export interface IntegrityViewProps {
  run: IntegrityRunner;
  /** Start a run automatically on mount. */
  autoRun?: boolean;
}

type RowStatus = 'pending' | IntegrityStatus;

interface Row extends IntegrityCheckDescriptor {
  status: RowStatus;
  findings: IntegrityFinding[];
  count: number;
  skipped?: string;
}

const TICK: Record<RowStatus, string> = { pending: '○', pass: '✓', fail: '✗', skip: '–' };

export function IntegrityView({ run, autoRun = false }: IntegrityViewProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<IntegritySummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    if (running) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setError(null);
    setSummary(null);
    setRows([]);

    try {
      await run({
        signal: ac.signal,
        onEvent: (ev) => {
          if (ev.type === 'manifest') {
            setRows(ev.checks.map((c) => ({ ...c, status: 'pending', findings: [], count: 0 })));
          } else if (ev.type === 'result') {
            const r = ev.result;
            setRows((prev) => prev.map((row) => (row.id === r.id
              ? { ...row, status: r.status, findings: r.findings, count: r.count, skipped: r.skipped }
              : row)));
          } else if (ev.type === 'done') {
            setSummary(ev.summary);
          } else if (ev.type === 'error') {
            setError(ev.error);
          }
        },
      });
    } catch (e: any) {
      if (!ac.signal.aborted) setError(e?.message ?? String(e));
    } finally {
      if (abortRef.current === ac) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }, [run, running]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  // Auto-run once on mount when asked.
  const autoRunRef = useRef(false);
  if (autoRun && !autoRunRef.current) {
    autoRunRef.current = true;
    // defer so state setters run after mount
    queueMicrotask(() => { void start(); });
  }

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      if (!map.has(row.group)) map.set(row.group, []);
      map.get(row.group)!.push(row);
    }
    return [...map.entries()];
  }, [rows]);

  const done = rows.filter((r) => r.status !== 'pending').length;

  return (
    <div className="IntegrityView">
      <div className="IntegrityView__header">
        <div className="IntegrityView__heading">
          <h2 className="IntegrityView__title">Datastore integrity</h2>
          <p className="IntegrityView__subtitle">Verifies the datastore against the 1.4.0 specification.</p>
        </div>
        <div className="IntegrityView__actions">
          {running
            ? <button type="button" className="IntegrityView__button IntegrityView__button--cancel" onClick={cancel}>Cancel</button>
            : <button type="button" className="IntegrityView__button" onClick={() => { void start(); }}>Run check</button>}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="IntegrityView__progress" role="status">
          {running ? `Checking… ${done}/${rows.length}` : summary ? summaryLine(summary) : `${done}/${rows.length}`}
          {summary && (
            <span className={`IntegrityView__badge IntegrityView__badge--${summary.ok ? 'ok' : 'fail'}`}>
              {summary.ok ? 'All checks passed' : `${summary.errorCount} error${summary.errorCount === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
      )}

      {error && <div className="IntegrityView__error">{error}</div>}

      {rows.length === 0 && !running && !error && (
        <div className="IntegrityView__empty">Press “Run check” to verify the datastore.</div>
      )}

      {groups.map(([group, groupRows]) => (
        <section className="IntegrityView__group" key={group}>
          <h3 className="IntegrityView__group-title">{group}</h3>
          <ul className="IntegrityView__list">
            {groupRows.map((row) => (
              <li className={`IntegrityView__row IntegrityView__row--${row.status}`} key={row.id}>
                <span className="IntegrityView__tick" aria-hidden="true">{TICK[row.status]}</span>
                <span className="IntegrityView__row-main">
                  <span className="IntegrityView__row-title">{row.title}</span>
                  {row.status === 'skip' && row.skipped && (
                    <span className="IntegrityView__row-note">skipped — {row.skipped}</span>
                  )}
                  {row.findings.length > 0 && (
                    <ul className="IntegrityView__findings">
                      {row.findings.map((f, i) => (
                        <li className={`IntegrityView__finding IntegrityView__finding--${f.severity}`} key={i}>
                          {f.message}
                          {f.fix && <span className="IntegrityView__fix">fix: {f.fix}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function summaryLine(s: IntegritySummary): string {
  return `${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped`;
}
