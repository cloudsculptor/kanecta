import { useQuery } from '@tanstack/react-query';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import PauseCircleIcon from '@mui/icons-material/PauseCircleOutlined';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircleOutlined';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { useWorkingSetStore } from '../../../store/workingSet';
import './PipelineView.scss';

export const PipelineViewMeta: ViewMeta = {
  uuid: 'b7c1e9a4-6f2d-4a83-9c17-2e5d8f0a1b34',
  name: 'pipelines',
  label: 'Pipelines',
  icon: 'Schema',
};

// ─── Normalised shape the presentation renders (adapter-agnostic) ───────────────

export type RunStatus = 'pending' | 'running' | 'waiting' | 'complete' | 'failed' | 'cancelled';
export type PhaseStatus = 'pending' | 'running' | 'waiting' | 'complete' | 'failed' | 'skipped';

export interface PhaseView {
  id: string;
  name: string;
  status: PhaseStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Best-effort token spend for this phase (from the phase's output map). */
  tokens?: number | null;
}

export interface RunView {
  id: string;
  runName: string;
  pipelineName: string;
  status: RunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  phases: PhaseView[];
}

// ─── Presentation — GitHub-Actions summary look ─────────────────────────────────

function fmtTokens(n?: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1000) return `${n} tok`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k tok`;
}

function fmtDuration(startISO?: string | null, endISO?: string | null): string {
  if (!startISO) return '';
  const start = Date.parse(startISO);
  const end = endISO ? Date.parse(endISO) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function StatusGlyph({ status }: { status: PhaseStatus | RunStatus }) {
  const cls = `PipelineView__glyph PipelineView__glyph--${status}`;
  switch (status) {
    case 'complete':
      return <CheckCircleIcon className={cls} titleAccess="complete" />;
    case 'failed':
      return <CancelIcon className={cls} titleAccess="failed" />;
    case 'cancelled':
      return <CancelIcon className={cls} titleAccess="cancelled" />;
    case 'running':
      return <AutorenewIcon className={`${cls} PipelineView__glyph--spin`} titleAccess="running" />;
    case 'waiting':
      return <PauseCircleIcon className={cls} titleAccess="waiting" />;
    case 'skipped':
      return <RemoveCircleIcon className={cls} titleAccess="skipped" />;
    default:
      return <ScheduleIcon className={cls} titleAccess="pending" />;
  }
}

export function PipelineRunSummary({ run }: { run: RunView }) {
  const done = run.phases.filter((p) => p.status === 'complete').length;
  const totalTokens = run.phases.reduce((sum, p) => sum + (p.tokens ?? 0), 0);
  return (
    <section className={`PipelineView__run PipelineView__run--${run.status}`} aria-label={run.runName}>
      <header className="PipelineView__run-header">
        <StatusGlyph status={run.status} />
        <div className="PipelineView__run-titles">
          <div className="PipelineView__run-name">{run.runName}</div>
          <div className="PipelineView__run-sub">
            {`${run.pipelineName} · ${done}/${run.phases.length} phases`}
            {totalTokens > 0 ? ` · ${fmtTokens(totalTokens)}` : ''}
          </div>
        </div>
        <div className="PipelineView__run-meta">
          <span className={`PipelineView__badge PipelineView__badge--${run.status}`}>{run.status}</span>
          <span className="PipelineView__run-duration">{fmtDuration(run.startedAt, run.completedAt)}</span>
        </div>
      </header>

      <ol className="PipelineView__phases">
        {run.phases.map((phase) => (
          <li key={phase.id} className={`PipelineView__phase PipelineView__phase--${phase.status}`}>
            <span className="PipelineView__phase-connector" aria-hidden />
            <StatusGlyph status={phase.status} />
            <span className="PipelineView__phase-name">{phase.name}</span>
            {fmtTokens(phase.tokens) && (
              <span className="PipelineView__phase-tokens">{fmtTokens(phase.tokens)}</span>
            )}
            <span className="PipelineView__phase-duration">
              {fmtDuration(phase.startedAt, phase.completedAt)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ─── Live-data wrapper ──────────────────────────────────────────────────────────

const PIPELINE_TYPE = 'pipeline';
const RUN_TYPE = 'pipeline-run';

interface RawItem {
  id: string;
  value?: string | null;
  type: string;
  parentId?: string | null;
  createdAt?: string;
}

interface RunPayload {
  status?: RunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  phases?: Array<{
    phaseId: string;
    status?: PhaseStatus;
    startedAt?: string | null;
    completedAt?: string | null;
    output?: { tokens?: number | null } | null;
  }>;
  pipelineSnapshot?: { phases?: Array<{ id: string; name: string }> } | null;
}

/** Build the normalised RunView list from the live items + their payloads. */
export function buildRuns(
  items: RawItem[],
  payloads: Record<string, RunPayload | null>,
  pipelinePayloads: Record<string, { phases?: Array<{ id: string; name: string }> } | null>,
): RunView[] {
  const pipelinesById = new Map(items.filter((i) => i.type === PIPELINE_TYPE).map((p) => [p.id, p]));
  const runs = items.filter((i) => i.type === RUN_TYPE);

  return runs
    .map((run) => {
      const payload = payloads[run.id] ?? {};
      const pipeline = run.parentId ? pipelinesById.get(run.parentId) : undefined;
      const nameByPhaseId = new Map<string, string>();
      const defPhases = payload.pipelineSnapshot?.phases
        ?? (pipeline ? pipelinePayloads[pipeline.id]?.phases : undefined)
        ?? [];
      for (const p of defPhases) nameByPhaseId.set(p.id, p.name);

      const phases: PhaseView[] = (payload.phases ?? []).map((ph) => ({
        id: ph.phaseId,
        name: nameByPhaseId.get(ph.phaseId) ?? ph.phaseId,
        status: ph.status ?? 'pending',
        startedAt: ph.startedAt ?? null,
        completedAt: ph.completedAt ?? null,
        tokens: ph.output?.tokens ?? null,
      }));

      return {
        id: run.id,
        runName: run.value ?? 'Run',
        pipelineName: pipeline?.value ?? 'Pipeline',
        status: payload.status ?? 'pending',
        startedAt: payload.startedAt ?? null,
        completedAt: payload.completedAt ?? null,
        phases,
      };
    })
    .sort((a, b) => a.runName.localeCompare(b.runName));
}

export function PipelineView() {
  useViewLocation(PipelineViewMeta.uuid);
  const { getApi, activeWorkingSetId } = useWorkingSetStore();
  const api = getApi();

  const { data, isLoading, error } = useQuery({
    queryKey: ['pipelines', activeWorkingSetId],
    // Poll so a live run's phases animate as they progress.
    refetchInterval: 2500,
    queryFn: async (): Promise<RunView[]> => {
      const items = (await api.items.list()) as RawItem[];
      const runs = items.filter((i) => i.type === RUN_TYPE);
      const pipelines = items.filter((i) => i.type === PIPELINE_TYPE);
      const payloads: Record<string, RunPayload | null> = {};
      const pipelinePayloads: Record<string, { phases?: Array<{ id: string; name: string }> } | null> = {};
      await Promise.all([
        ...runs.map(async (r) => {
          payloads[r.id] = (await api.items.getObject(r.id).catch(() => null)) as RunPayload | null;
        }),
        ...pipelines.map(async (p) => {
          pipelinePayloads[p.id] = (await api.items.getObject(p.id).catch(() => null)) as {
            phases?: Array<{ id: string; name: string }>;
          } | null;
        }),
      ]);
      return buildRuns(items, payloads, pipelinePayloads);
    },
  });

  return (
    <div className="PipelineView">
      <div className="PipelineView__header">
        <h1 className="PipelineView__title">Pipelines</h1>
      </div>
      {isLoading && <p className="PipelineView__empty">Loading pipeline runs…</p>}
      {error && <p className="PipelineView__empty">Couldn’t load pipelines.</p>}
      {!isLoading && !error && (data?.length ?? 0) === 0 && (
        <p className="PipelineView__empty">No pipeline runs yet.</p>
      )}
      <div className="PipelineView__runs">
        {data?.map((run) => (
          <PipelineRunSummary key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}
