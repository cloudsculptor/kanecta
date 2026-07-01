import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import PauseCircleIcon from '@mui/icons-material/PauseCircleOutlined';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircleOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SchemaIcon from '@mui/icons-material/Schema';
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
  /** Condensed transcript log for this phase's time window (from output.log). */
  log?: string | null;
}

export interface RunView {
  id: string;
  pipelineId: string;
  runName: string;
  pipelineName: string;
  status: RunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  phases: PhaseView[];
}

export interface PipelineParam {
  name: string;
  type: string;
  required: boolean;
  description?: string | null;
}

export interface PipelinePhaseDef {
  id: string;
  name: string;
  agentId?: string | null;
  needs?: string[];
}

/** A pipeline's configuration (its definition), shown when a pipeline is selected. */
export interface PipelineConfigView {
  description?: string | null;
  params: PipelineParam[];
  phases: PipelinePhaseDef[];
}

/** A pipeline and its runs — the unit of the left browse column. */
export interface PipelineGroup {
  id: string;
  name: string;
  config: PipelineConfigView;
  runs: RunView[];
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        {run.phases.map((phase) => {
          const hasLog = Boolean(phase.log && phase.log.trim());
          const isOpen = expanded.has(phase.id);
          return (
            <li
              key={phase.id}
              className={`PipelineView__phase PipelineView__phase--${phase.status}${
                hasLog ? ' PipelineView__phase--has-log' : ''
              }`}
            >
              <div
                className="PipelineView__phase-row"
                role={hasLog ? 'button' : undefined}
                tabIndex={hasLog ? 0 : undefined}
                aria-expanded={hasLog ? isOpen : undefined}
                onClick={hasLog ? () => toggle(phase.id) : undefined}
                onKeyDown={
                  hasLog
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(phase.id);
                        }
                      }
                    : undefined
                }
              >
                <span className="PipelineView__phase-connector" aria-hidden />
                <StatusGlyph status={phase.status} />
                <span className="PipelineView__phase-name">{phase.name}</span>
                {fmtTokens(phase.tokens) && (
                  <span className="PipelineView__phase-tokens">{fmtTokens(phase.tokens)}</span>
                )}
                <span className="PipelineView__phase-duration">
                  {fmtDuration(phase.startedAt, phase.completedAt)}
                </span>
                {hasLog && (
                  <ExpandMoreIcon
                    className={`PipelineView__phase-caret${
                      isOpen ? ' PipelineView__phase-caret--open' : ''
                    }`}
                  />
                )}
              </div>
              {hasLog && isOpen && <pre className="PipelineView__phase-log">{phase.log}</pre>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function PipelineConfigSummary({ name, config }: { name: string; config: PipelineConfigView }) {
  return (
    <section className="PipelineView__config" aria-label={`${name} configuration`}>
      <header className="PipelineView__config-header">
        <div className="PipelineView__config-name">{name}</div>
        <span className="PipelineView__config-tag">pipeline</span>
      </header>
      {config.description && <p className="PipelineView__config-desc">{config.description}</p>}

      {config.params.length > 0 && (
        <div className="PipelineView__config-block">
          <h3 className="PipelineView__config-heading">Parameters</h3>
          <ul className="PipelineView__config-params">
            {config.params.map((p) => (
              <li key={p.name} className="PipelineView__config-param">
                <code className="PipelineView__config-param-name">{p.name}</code>
                <span className="PipelineView__config-param-type">{p.type}</span>
                {p.required && <span className="PipelineView__config-param-req">required</span>}
                {p.description && (
                  <span className="PipelineView__config-param-desc">{p.description}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="PipelineView__config-block">
        <h3 className="PipelineView__config-heading">Phases ({config.phases.length})</h3>
        <ol className="PipelineView__config-phases">
          {config.phases.map((ph) => (
            <li key={ph.id} className="PipelineView__config-phase">
              <span className="PipelineView__config-phase-connector" aria-hidden />
              <span className="PipelineView__config-phase-dot" aria-hidden />
              <span className="PipelineView__config-phase-body">
                <span className="PipelineView__config-phase-name">{ph.name}</span>
                <span className="PipelineView__config-phase-meta">
                  {ph.agentId ? `agent ${ph.agentId.slice(0, 8)}` : 'no agent'}
                  {ph.needs && ph.needs.length > 0 ? ` · needs ${ph.needs.join(', ')}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ─── Live-data wrapper ──────────────────────────────────────────────────────────

const PIPELINE_TYPE = 'pipeline';
const RUN_TYPE = 'pipeline-run';
// The built-in `pipeline` type item — always present. Pipeline instances live as
// its children; each pipeline's runs live as children of the pipeline.
const PIPELINE_TYPE_ID = '90bdc2b2-0963-4ec9-a37c-4b42f724752d';

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
    output?: { tokens?: number | null; log?: string | null } | null;
  }>;
  pipelineSnapshot?: { phases?: Array<{ id: string; name: string }> } | null;
}

interface PipelinePayload {
  description?: string | null;
  params?: PipelineParam[] | null;
  phases?: PipelinePhaseDef[] | null;
}

/** Build the normalised RunView list from the live items + their payloads. */
export function buildRuns(
  items: RawItem[],
  payloads: Record<string, RunPayload | null>,
  pipelinePayloads: Record<string, PipelinePayload | null>,
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
        log: ph.output?.log ?? null,
      }));

      return {
        id: run.id,
        pipelineId: pipeline?.id ?? run.parentId ?? '',
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

/** Group every pipeline with its config + runs (pipelines with no runs appear too). */
export function groupPipelines(
  pipelines: RawItem[],
  runs: RunView[],
  pipelinePayloads: Record<string, PipelinePayload | null>,
): PipelineGroup[] {
  return pipelines
    .map((p) => {
      const pl = pipelinePayloads[p.id] ?? {};
      return {
        id: p.id,
        name: p.value ?? 'Pipeline',
        config: {
          description: pl.description ?? null,
          params: pl.params ?? [],
          phases: pl.phases ?? [],
        },
        runs: runs.filter((r) => r.pipelineId === p.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

type Selection = { kind: 'pipeline' | 'run'; id: string };

export function PipelineView() {
  useViewLocation(PipelineViewMeta.uuid);
  const { getApi, activeWorkingSetId } = useWorkingSetStore();
  const api = getApi();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['pipelines', activeWorkingSetId],
    // Poll so a live run's phases animate as they progress.
    refetchInterval: 2500,
    queryFn: async (): Promise<PipelineGroup[]> => {
      // Pipeline instances are children of the built-in `pipeline` type item;
      // filter out the type's own synthetic schema-field nodes. Each pipeline's
      // runs are its children.
      const typeChildren = (await api.items.children(PIPELINE_TYPE_ID)) as RawItem[];
      const pipelines = typeChildren.filter((i) => i.type === PIPELINE_TYPE);

      const runArrays = await Promise.all(
        pipelines.map((p) => api.items.children(p.id).catch(() => []) as Promise<RawItem[]>),
      );
      const runItems = runArrays.flat().filter((i) => i.type === RUN_TYPE);
      const items = [...pipelines, ...runItems];

      const payloads: Record<string, RunPayload | null> = {};
      const pipelinePayloads: Record<string, PipelinePayload | null> = {};
      await Promise.all([
        ...runItems.map(async (r) => {
          payloads[r.id] = (await api.items.getObject(r.id).catch(() => null)) as RunPayload | null;
        }),
        ...pipelines.map(async (p) => {
          pipelinePayloads[p.id] = (await api.items.getObject(p.id).catch(() => null)) as PipelinePayload | null;
        }),
      ]);
      const runs = buildRuns(items, payloads, pipelinePayloads);
      return groupPipelines(pipelines, runs, pipelinePayloads);
    },
  });

  const groups = data ?? [];
  const allRuns = groups.flatMap((g) => g.runs);

  // Resolve the current selection, defaulting to the first run (else first pipeline).
  let resolved: Selection | null = selection;
  if (resolved) {
    const stillExists =
      resolved.kind === 'run'
        ? allRuns.some((r) => r.id === resolved!.id)
        : groups.some((g) => g.id === resolved!.id);
    if (!stillExists) resolved = null;
  }
  if (!resolved) {
    if (allRuns[0]) resolved = { kind: 'run', id: allRuns[0].id };
    else if (groups[0]) resolved = { kind: 'pipeline', id: groups[0].id };
  }

  const selectedRun = resolved?.kind === 'run' ? allRuns.find((r) => r.id === resolved!.id) : null;
  const selectedPipeline =
    resolved?.kind === 'pipeline' ? groups.find((g) => g.id === resolved!.id) : null;

  return (
    <div className={`PipelineView${collapsed ? ' PipelineView--collapsed' : ''}`}>
      {/* ── Left: browse pipelines → runs ── */}
      <aside className="PipelineView__sidebar">
        <div className="PipelineView__sidebar-header">
          {!collapsed && <span className="PipelineView__sidebar-title">Pipelines</span>}
          <button
            className="PipelineView__collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand pipeline list' : 'Collapse pipeline list'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>
        </div>

        {!collapsed && (
          <>
            {isLoading && <p className="PipelineView__empty">Loading…</p>}
            {error && <p className="PipelineView__empty">Couldn’t load pipelines.</p>}
            {!isLoading && !error && groups.length === 0 && (
              <p className="PipelineView__empty">No pipelines yet.</p>
            )}
            {groups.map((group) => (
              <div key={group.id} className="PipelineView__group">
                <button
                  className={`PipelineView__group-name${
                    resolved?.kind === 'pipeline' && resolved.id === group.id
                      ? ' PipelineView__group-name--active'
                      : ''
                  }`}
                  title={group.name}
                  onClick={() => setSelection({ kind: 'pipeline', id: group.id })}
                >
                  <SchemaIcon className="PipelineView__group-icon" />
                  <span className="PipelineView__group-label">{group.name}</span>
                </button>
                {group.runs.length === 0 ? (
                  <div className="PipelineView__group-empty">No runs</div>
                ) : (
                  <ul className="PipelineView__run-list">
                    {group.runs.map((run) => (
                      <li key={run.id}>
                        <button
                          className={`PipelineView__run-link${
                            resolved?.kind === 'run' && resolved.id === run.id
                              ? ' PipelineView__run-link--active'
                              : ''
                          }`}
                          onClick={() => setSelection({ kind: 'run', id: run.id })}
                        >
                          <StatusGlyph status={run.status} />
                          <span className="PipelineView__run-link-name">{run.runName}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </>
        )}
      </aside>

      {/* ── Right: config (pipeline) or run summary (run) ── */}
      <div className="PipelineView__detail">
        {selectedRun && <PipelineRunSummary run={selectedRun} />}
        {selectedPipeline && (
          <PipelineConfigSummary name={selectedPipeline.name} config={selectedPipeline.config} />
        )}
        {!selectedRun && !selectedPipeline && !isLoading && (
          <p className="PipelineView__empty">Select a pipeline or run.</p>
        )}
      </div>
    </div>
  );
}
