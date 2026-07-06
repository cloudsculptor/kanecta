import { useState } from 'react';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import AddIcon from '@mui/icons-material/Add';
import './PullRequestsView.scss';

type MainTab = 'list' | 'detail' | 'merge';
type ListFilter = 'open' | 'closed';
type DetailTab = 'conversation' | 'commits' | 'files';

interface MockPR {
  id: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  branch: string;
  author: string;
  createdAt: string;
  comments: number;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  labels?: string[];
}

interface DiffLine {
  type: 'context' | 'add' | 'del';
  content: string;
}

interface DiffFile {
  path: string;
  isNew?: boolean;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

const OPEN_PRS: MockPR[] = [
  {
    id: 66,
    title: 'feat(governance): dynamic procedures/policies index via site_nodes',
    state: 'open',
    branch: 'feat/site-nodes',
    author: 'cloudsculptor',
    createdAt: '2026-06-20T01:09:29Z',
    comments: 0,
    additions: 1806,
    deletions: 109,
    changedFiles: 22,
    labels: ['enhancement'],
  },
  {
    id: 62,
    title: 'fix(tree-view): value disappears after inline edit',
    state: 'open',
    branch: 'fix/tree-node-edit-value-disappears',
    author: 'cloudsculptor',
    createdAt: '2026-06-17T18:47:13Z',
    comments: 0,
    additions: 45,
    deletions: 12,
    changedFiles: 3,
    labels: ['bug'],
  },
  {
    id: 58,
    title: 'feat(merge): Datastore v1.4.0 with merge to sync database',
    state: 'open',
    branch: 'feature/v1.4.0-with-merge',
    author: 'cloudsculptor',
    createdAt: '2026-06-17T17:18:46Z',
    comments: 0,
    additions: 4230,
    deletions: 180,
    changedFiles: 67,
    labels: ['enhancement'],
  },
];

const CLOSED_PRS: MockPR[] = [
  {
    id: 67,
    title: 'fix(ci): use git rev-parse HEAD for accurate deploy SHA in build info',
    state: 'merged',
    branch: 'fix/nonprod-deploy-sha',
    author: 'cloudsculptor',
    createdAt: '2026-06-20T02:26:08Z',
    comments: 0,
  },
  {
    id: 65,
    title: 'fix(ci): nonprod deploy is manual-only with branch input',
    state: 'merged',
    branch: 'fix/nonprod-manual-deploy-only',
    author: 'cloudsculptor',
    createdAt: '2026-06-19T23:27:59Z',
    comments: 0,
  },
  {
    id: 64,
    title: 'feat(governance): dynamic editable governance sections (issue #19)',
    state: 'closed',
    branch: 'feat/governance-dynamic-pages',
    author: 'cloudsculptor',
    createdAt: '2026-06-19T23:25:42Z',
    comments: 0,
  },
  {
    id: 63,
    title: 'feat(site-pages): make top-level site pages editable by moderators',
    state: 'merged',
    branch: 'test/community-hub-site-pages-editing',
    author: 'cloudsculptor',
    createdAt: '2026-06-18T17:34:50Z',
    comments: 0,
  },
];

const DETAIL_PR = OPEN_PRS[0];

const MOCK_COMMITS = [
  { sha: 'e673a7c', message: 'chore(governance): remove WIP banner from procedures and policies index', author: 'cloudsculptor', date: '2026-06-20T01:49:28Z' },
  { sha: 'a630585', message: 'feat(governance): edit, reorder, delete and audit trail for site nodes', author: 'cloudsculptor', date: '2026-06-20T01:22:01Z' },
  { sha: '32a95bf', message: 'feat(governance): add description field to SiteNodeEditor for categories', author: 'cloudsculptor', date: '2026-06-20T01:17:41Z' },
  { sha: '05a3a53', message: 'fix(governance): use useUserRoles/hasRole instead of non-existent useUserRole', author: 'cloudsculptor', date: '2026-06-20T01:12:05Z' },
  { sha: 'e40b3cb', message: 'feat(governance): add site_nodes table and dynamic procedures/policies index', author: 'cloudsculptor', date: '2026-06-20T00:56:15Z' },
  { sha: 'c6432c8', message: 'feat(governance): dynamic editable governance sections (issue #19)', author: 'cloudsculptor', date: '2026-06-19T23:25:21Z' },
];

const MOCK_DIFF_FILES: DiffFile[] = [
  {
    path: 'kanecta-api/src/routes/site-nodes.ts',
    isNew: true,
    additions: 45,
    deletions: 0,
    lines: [
      { type: 'add', content: "import { Router } from 'express';" },
      { type: 'add', content: "import { pool } from '../db';" },
      { type: 'add', content: '' },
      { type: 'add', content: 'export const siteNodesRouter = Router();' },
      { type: 'add', content: '' },
      { type: 'add', content: "siteNodesRouter.get('/tree', async (req, res) => {" },
      { type: 'add', content: '  const { rows } = await pool.query(`' },
      { type: 'add', content: '    WITH RECURSIVE tree AS (' },
      { type: 'add', content: '      SELECT *, 0 AS depth FROM site_nodes WHERE parent_id IS NULL' },
      { type: 'add', content: '      UNION ALL' },
      { type: 'add', content: '      SELECT n.*, t.depth + 1 FROM site_nodes n JOIN tree t ON n.parent_id = t.id' },
      { type: 'add', content: '    ) SELECT * FROM tree ORDER BY depth, sort_order`' },
      { type: 'add', content: '  );' },
      { type: 'add', content: '  res.json(rows);' },
      { type: 'add', content: '});' },
    ],
  },
  {
    path: 'kanecta-api/migrations/030_create_site_nodes.sql',
    isNew: true,
    additions: 31,
    deletions: 0,
    lines: [
      { type: 'add', content: 'CREATE TABLE site_nodes (' },
      { type: 'add', content: '  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),' },
      { type: 'add', content: '  slug       TEXT NOT NULL UNIQUE,' },
      { type: 'add', content: '  title      TEXT NOT NULL,' },
      { type: 'add', content: '  node_type  TEXT NOT NULL,' },
      { type: 'add', content: '  parent_id  UUID REFERENCES site_nodes(id) ON DELETE SET NULL,' },
      { type: 'add', content: "  metadata   JSONB NOT NULL DEFAULT '{}'," },
      { type: 'add', content: '  sort_order INTEGER NOT NULL DEFAULT 0,' },
      { type: 'add', content: '  deleted_at TIMESTAMPTZ,' },
      { type: 'add', content: '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),' },
      { type: 'add', content: '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()' },
      { type: 'add', content: ');' },
    ],
  },
  {
    path: 'kanecta-apps/featherston-community-hub-web/src/components/ProceduresIndex.tsx',
    additions: 67,
    deletions: 23,
    lines: [
      { type: 'context', content: "import React, { useEffect, useState } from 'react';" },
      { type: 'del', content: "const STATIC_CATEGORIES = [" },
      { type: 'del', content: "  { slug: 'agm', label: 'AGM' }," },
      { type: 'del', content: "  { slug: 'general-meetings', label: 'General Meetings' }," },
      { type: 'del', content: "  { slug: 'rules', label: 'Rules' }," },
      { type: 'del', content: "];" },
      { type: 'add', content: "import { useSiteNodes } from '../hooks/useSiteNodes';" },
      { type: 'add', content: "import { SiteNodeEditor } from './SiteNodeEditor';" },
      { type: 'add', content: '' },
      { type: 'add', content: 'export function ProceduresIndex() {' },
      { type: 'add', content: "  const { nodes, loading } = useSiteNodes({ type: 'procedures' });" },
      { type: 'add', content: '  if (loading) return <Spinner />;' },
      { type: 'context', content: '  return (' },
      { type: 'context', content: '    <div className="procedures-index">' },
    ],
  },
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

function PrStateIcon({ state }: { state: MockPR['state'] }) {
  if (state === 'merged') return <MergeTypeIcon className="PRIcon PRIcon--merged" />;
  if (state === 'closed') return <AltRouteIcon className="PRIcon PRIcon--closed" />;
  return <AltRouteIcon className="PRIcon PRIcon--open" />;
}

function PrListTab() {
  const [filter, setFilter] = useState<ListFilter>('open');
  const prs = filter === 'open' ? OPEN_PRS : CLOSED_PRS;

  return (
    <div className="PullRequestsView__list-page">
      <div className="PullRequestsView__list-header">
        <h2 className="PullRequestsView__list-title">Pull requests</h2>
        <button className="PullRequestsView__new-btn">
          <AddIcon fontSize="small" />
          New pull request
        </button>
      </div>

      <div className="PullRequestsView__filter-bar">
        <div className="PullRequestsView__state-tabs">
          <button
            className={`PullRequestsView__state-tab${filter === 'open' ? ' PullRequestsView__state-tab--active' : ''}`}
            onClick={() => setFilter('open')}
          >
            <AltRouteIcon fontSize="inherit" />
            Open <span className="PullRequestsView__count">{OPEN_PRS.length}</span>
          </button>
          <button
            className={`PullRequestsView__state-tab${filter === 'closed' ? ' PullRequestsView__state-tab--active' : ''}`}
            onClick={() => setFilter('closed')}
          >
            <MergeTypeIcon fontSize="inherit" />
            Closed <span className="PullRequestsView__count">{CLOSED_PRS.length}</span>
          </button>
        </div>
      </div>

      <ul className="PullRequestsView__pr-list">
        {prs.map((pr, i) => (
          <li key={pr.id} className={`PullRequestsView__pr-row${i === 0 ? ' PullRequestsView__pr-row--first' : ''}`}>
            <PrStateIcon state={pr.state} />
            <div className="PullRequestsView__pr-body">
              <div className="PullRequestsView__pr-title-row">
                <span className="PullRequestsView__pr-title">{pr.title}</span>
                {pr.labels?.map(l => (
                  <span key={l} className={`PullRequestsView__label PullRequestsView__label--${l}`}>{l}</span>
                ))}
              </div>
              <div className="PullRequestsView__pr-meta">
                #{pr.id} {pr.state === 'open' ? 'opened' : pr.state} {relativeTime(pr.createdAt)} by {pr.author}
                {' · '}
                <span className="PullRequestsView__pr-branch">{pr.branch}</span>
              </div>
            </div>
            {pr.comments > 0 && (
              <div className="PullRequestsView__pr-comments">
                <ChatBubbleOutlineIcon fontSize="inherit" />
                {pr.comments}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffFileView({ file }: { file: DiffFile }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="PullRequestsView__diff-file">
      <div className="PullRequestsView__diff-file-header" onClick={() => setCollapsed(c => !c)}>
        <span className="PullRequestsView__diff-file-path">
          {file.isNew && <span className="PullRequestsView__diff-new-badge">new file</span>}
          {file.path}
        </span>
        <span className="PullRequestsView__diff-stats">
          <span className="PullRequestsView__diff-add">+{file.additions}</span>
          {file.deletions > 0 && <span className="PullRequestsView__diff-del">-{file.deletions}</span>}
        </span>
      </div>
      {!collapsed && (
        <table className="PullRequestsView__diff-table">
          <tbody>
            {file.lines.map((line, i) => (
              <tr key={i} className={`PullRequestsView__diff-line PullRequestsView__diff-line--${line.type}`}>
                <td className="PullRequestsView__diff-gutter">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                </td>
                <td className="PullRequestsView__diff-code">{line.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PrDetailTab() {
  const [subTab, setSubTab] = useState<DetailTab>('files');
  const pr = DETAIL_PR;

  return (
    <div className="PullRequestsView__detail-page">
      <div className="PullRequestsView__detail-header">
        <h2 className="PullRequestsView__detail-title">
          {pr.title}
          <span className="PullRequestsView__detail-number">#{pr.id}</span>
        </h2>
        <div className="PullRequestsView__detail-status-row">
          <span className="PullRequestsView__open-badge">
            <AltRouteIcon fontSize="inherit" /> Open
          </span>
          <span className="PullRequestsView__detail-meta">
            <strong>{pr.author}</strong> wants to merge {MOCK_COMMITS.length} commits into <code>master</code> from <code>{pr.branch}</code>
          </span>
        </div>
      </div>

      <div className="PullRequestsView__detail-tabs">
        {([
          { id: 'conversation', label: 'Conversation', count: 0 },
          { id: 'commits', label: 'Commits', count: MOCK_COMMITS.length },
          { id: 'files', label: 'Files changed', count: pr.changedFiles },
        ] as { id: DetailTab; label: string; count?: number }[]).map(t => (
          <button
            key={t.id}
            className={`PullRequestsView__detail-tab${subTab === t.id ? ' PullRequestsView__detail-tab--active' : ''}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="PullRequestsView__detail-tab-count">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="PullRequestsView__detail-body">
        {subTab === 'conversation' && (
          <div className="PullRequestsView__conversation">
            <div className="PullRequestsView__pr-desc-card">
              <div className="PullRequestsView__pr-desc-header">
                <strong>{pr.author}</strong>
                <span className="PullRequestsView__pr-desc-meta">commented {relativeTime(pr.createdAt)}</span>
              </div>
              <div className="PullRequestsView__pr-desc-body">
                <p><strong>Summary</strong></p>
                <ul>
                  <li>Adds a <code>site_nodes</code> table — a generic tree structure (slug, title, node_type, parent_id, metadata JSONB)</li>
                  <li>Seeds the full governance navigation tree: procedures (3 groups, 10 categories) and policies (2 groups, 4 categories)</li>
                  <li><code>ProceduresIndex</code> and <code>PoliciesIndex</code> now load from <code>/api/site-nodes/tree</code> instead of hardcoded arrays</li>
                  <li>Moderators see inline controls to rename groups/categories and add new ones</li>
                </ul>
              </div>
            </div>
            <div className="PullRequestsView__no-reviews">No reviews yet</div>
          </div>
        )}

        {subTab === 'commits' && (
          <ul className="PullRequestsView__commit-list">
            {MOCK_COMMITS.map(c => (
              <li key={c.sha} className="PullRequestsView__commit-row">
                <span className="PullRequestsView__commit-sha">{c.sha}</span>
                <span className="PullRequestsView__commit-msg">{c.message}</span>
                <span className="PullRequestsView__commit-meta">{c.author} · {relativeTime(c.date)}</span>
              </li>
            ))}
          </ul>
        )}

        {subTab === 'files' && (
          <div className="PullRequestsView__files-changed">
            <div className="PullRequestsView__files-summary">
              Showing <strong>{MOCK_DIFF_FILES.length} of {pr.changedFiles}</strong> changed files &nbsp;
              <span className="PullRequestsView__diff-add">+{pr.additions}</span>
              {' '}
              <span className="PullRequestsView__diff-del">-{pr.deletions}</span>
            </div>
            {MOCK_DIFF_FILES.map(f => (
              <DiffFileView key={f.path} file={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MergeSyncTab() {
  return (
    <div className="PullRequestsView__merge-page">
      <div className="PullRequestsView__empty">Merge / Sync — coming soon</div>
    </div>
  );
}

export function PullRequestsView() {
  const [tab, setTab] = useState<MainTab>('list');

  return (
    <div className="PullRequestsView">
      <nav className="PullRequestsView__tabs">
        {([
          { id: 'list', label: 'Pull Requests' },
          { id: 'detail', label: `PR #${DETAIL_PR.id}` },
          { id: 'merge', label: 'Merge / Sync' },
        ] as { id: MainTab; label: string }[]).map(t => (
          <button
            key={t.id}
            className={`PullRequestsView__tab${tab === t.id ? ' PullRequestsView__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="PullRequestsView__content">
        {tab === 'list' && <PrListTab />}
        {tab === 'detail' && <PrDetailTab />}
        {tab === 'merge' && <MergeSyncTab />}
      </div>
    </div>
  );
}
