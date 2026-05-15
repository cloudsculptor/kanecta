import { useState } from 'react';
import { useWorkspaceStore } from '../store/workspace';
import { useReviewStore } from '../store/review';
import type { WorkspaceConfig } from '../types/workspace';
import './SettingsPage.scss';

const COLOUR_PRESETS = ['#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c62828', '#0097a7'];

function WorkspaceRow({
  workspace,
  onUpdate,
  onRemove,
  isOnly,
}: {
  workspace: WorkspaceConfig;
  onUpdate: (updates: Partial<WorkspaceConfig>) => void;
  onRemove: () => void;
  isOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkspaceConfig>(workspace);

  const save = () => {
    onUpdate(draft);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="SettingsPage-ws-row">
        <span
          className="SettingsPage-ws-dot"
          style={{ background: workspace.colour }}
        />
        <span className="SettingsPage-ws-name">{workspace.name}</span>
        <span className="SettingsPage-ws-url">{workspace.apiUrl}</span>
        <span className="SettingsPage-ws-poll">{workspace.pollIntervalMs / 1000}s</span>
        <button className="SettingsPage-btn" onClick={() => setEditing(true)}>Edit</button>
        <button
          className="SettingsPage-btn SettingsPage-btn--danger"
          onClick={onRemove}
          disabled={isOnly}
          title={isOnly ? 'Cannot remove the only workspace' : undefined}
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="SettingsPage-ws-form">
      <label className="SettingsPage-label">
        Name
        <input
          className="SettingsPage-input"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </label>
      <label className="SettingsPage-label">
        API URL
        <input
          className="SettingsPage-input"
          value={draft.apiUrl}
          onChange={(e) => setDraft((d) => ({ ...d, apiUrl: e.target.value }))}
        />
      </label>
      <label className="SettingsPage-label">
        Poll interval (ms)
        <input
          className="SettingsPage-input"
          type="number"
          min={1000}
          step={1000}
          value={draft.pollIntervalMs}
          onChange={(e) => setDraft((d) => ({ ...d, pollIntervalMs: Number(e.target.value) }))}
        />
      </label>
      <div className="SettingsPage-label">
        Colour
        <div className="SettingsPage-colours">
          {COLOUR_PRESETS.map((c) => (
            <button
              key={c}
              className={`SettingsPage-colour-swatch${draft.colour === c ? ' SettingsPage-colour-swatch--selected' : ''}`}
              style={{ background: c }}
              onClick={() => setDraft((d) => ({ ...d, colour: c }))}
              aria-label={c}
            />
          ))}
        </div>
      </div>
      <div className="SettingsPage-ws-form-actions">
        <button className="SettingsPage-btn SettingsPage-btn--primary" onClick={save}>Save</button>
        <button className="SettingsPage-btn" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { workspaces, addWorkspace, updateWorkspace, removeWorkspace } = useWorkspaceStore();
  const { unreviewedThreshold, setUnreviewedThreshold } = useReviewStore();

  const handleAdd = () => {
    addWorkspace({
      name: 'New Workspace',
      apiUrl: 'http://localhost:3000',
      colour: COLOUR_PRESETS[workspaces.length % COLOUR_PRESETS.length],
      pollIntervalMs: 5000,
    });
  };

  return (
    <div className="SettingsPage" role="dialog" aria-label="Settings">
      <div className="SettingsPage-header">
        <h2 className="SettingsPage-title">Settings</h2>
        <button className="SettingsPage-close" onClick={onClose} aria-label="Close settings">×</button>
      </div>

      <div className="SettingsPage-body">
        <section className="SettingsPage-section">
          <h3 className="SettingsPage-section-title">Workspaces</h3>
          <div className="SettingsPage-ws-list">
            {workspaces.map((ws) => (
              <WorkspaceRow
                key={ws.id}
                workspace={ws}
                onUpdate={(updates) => updateWorkspace(ws.id, updates)}
                onRemove={() => removeWorkspace(ws.id)}
                isOnly={workspaces.length === 1}
              />
            ))}
          </div>
          <button className="SettingsPage-btn SettingsPage-btn--primary" onClick={handleAdd}>
            + Add Workspace
          </button>
        </section>

        <section className="SettingsPage-section">
          <h3 className="SettingsPage-section-title">Review</h3>
          <label className="SettingsPage-label">
            Pause indicator threshold (unreviewed items)
            <input
              className="SettingsPage-input"
              type="number"
              min={1}
              value={unreviewedThreshold}
              onChange={(e) => setUnreviewedThreshold(Number(e.target.value))}
            />
          </label>
        </section>
      </div>
    </div>
  );
}
