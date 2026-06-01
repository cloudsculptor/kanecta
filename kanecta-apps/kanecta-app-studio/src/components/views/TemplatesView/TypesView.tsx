import { useState, useEffect, useRef } from 'react';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';

export const TypesViewMeta: ViewMeta = {
  uuid: 'd5c4e3f2-a6b7-4c8d-9e0f-1a2b3c4d5e6f',
  name: 'types',
  label: 'Types',
  icon: 'DashboardCustomize',
};
import { useQueryClient } from '@tanstack/react-query';
import Ajv from 'ajv';
import SyncIcon from '@mui/icons-material/Sync';
import typeSpecRaw from '../../../../../../kanecta-specification/1.2.0/file-specs/type.json?raw';
import { useWorkspaceStore } from '../../../store/workspace';
import { TypeList } from '../../shared/TypeList';
import { SyncTypesDialog } from './SyncTypesDialog';
import type { TypeDefinition } from '../../../api/types';
import type { ItemType } from '../../../types/kanecta';
import './TypesView.scss';

type Tab = 'item' | 'view' | 'meta' | 'meta-edit' | 'schema' | 'edit' | 'reference';

const ICONS_URL = 'https://mui.com/material-ui/material-icons/';

interface MetaFields {
  icon: string;
  description: string;
  details: string;
  keywords: string;
  tags: string;
  claude: string;
}

function parseMeta(schema: string): MetaFields {
  try {
    const d = JSON.parse(schema);
    const m = d.meta ?? {};
    return {
      icon:        m.icon ?? '',
      description: m.description ?? '',
      details:     m.details ?? '',
      keywords:    m.keywords ?? '',
      tags:        m.tags ?? '',
      claude:      m['ai-instructions']?.claude ?? '',
    };
  } catch {
    return { icon: '', description: '', details: '', keywords: '', tags: '', claude: '' };
  }
}

function validateTypeDef(text: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (e) { return `Invalid JSON: ${(e as Error).message}`; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Must be a JSON object';
  const obj = parsed as Record<string, unknown>;
  if (!obj['meta'] || typeof obj['meta'] !== 'object') return 'Missing "meta" object';
  if (!obj['jsonSchema'] || typeof obj['jsonSchema'] !== 'object') return 'Missing or invalid "jsonSchema" field';
  return null;
}

function prettify(text: string): { result: string; error: string | null } {
  try { return { result: JSON.stringify(JSON.parse(text), null, 2), error: null }; }
  catch (e) { return { result: text, error: `Invalid JSON: ${(e as Error).message}` }; }
}

function extractSection(schema: string, key: string): string {
  try { return JSON.stringify(JSON.parse(schema)[key], null, 2); } catch { return ''; }
}

// ─── Meta form editor ────────────────────────────────────────────────────────

interface MetaEditorProps {
  typeId: string;
  schema: string;
  onSchemaChange: (s: string) => void;
}

function MetaEditor({ typeId, schema, onSchemaChange }: MetaEditorProps) {
  const { getApi } = useWorkspaceStore();
  const [fields, setFields] = useState<MetaFields>(() => parseMeta(schema));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFields(parseMeta(schema)); setSaveError(null); setSaveOk(false);
  }, [schema, typeId]);

  const set = (key: keyof MetaFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFields(f => ({ ...f, [key]: e.target.value }));
    setSaveError(null); setSaveOk(false);
  };

  const handleSave = async () => {
    setSaveError(null); setSaveOk(false);
    try {
      const current = JSON.parse(schema);
      const updated = {
        ...current,
        meta: {
          icon:              fields.icon,
          description:       fields.description,
          details:           fields.details,
          keywords:          fields.keywords,
          tags:              fields.tags,
          'ai-instructions': { claude: fields.claude },
        },
      };
      await getApi().types.saveSchema(typeId, updated);
      onSchemaChange(JSON.stringify(updated, null, 2));
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  return (
    <div className="TypesView-editwrap">
      <div className="TypesView-metaform">
        <div className="TypesView-field">
          <label className="TypesView-label">Icon</label>
          <input
            className="TypesView-input"
            value={fields.icon}
            onChange={set('icon')}
            placeholder="e.g. TaskAlt"
            spellCheck={false}
          />
          <span className="TypesView-hint">
            MUI icon key — <a href={ICONS_URL} target="_blank" rel="noreferrer" className="TypesView-hint-link">browse icons ↗</a>
          </span>
        </div>
        <div className="TypesView-field">
          <label className="TypesView-label">Description</label>
          <input
            className="TypesView-input"
            value={fields.description}
            onChange={set('description')}
            placeholder="One-sentence summary"
          />
        </div>
        <div className="TypesView-field">
          <label className="TypesView-label">Details</label>
          <textarea
            className="TypesView-textarea"
            value={fields.details}
            onChange={set('details')}
            rows={5}
            placeholder="Longer description of this type, when to use it, and how it relates to other types"
          />
        </div>
        <div className="TypesView-field">
          <label className="TypesView-label">Keywords</label>
          <input
            className="TypesView-input"
            value={fields.keywords}
            onChange={set('keywords')}
            placeholder="Space-separated keywords for search"
            spellCheck={false}
          />
        </div>
        <div className="TypesView-field">
          <label className="TypesView-label">Tags</label>
          <input
            className="TypesView-input"
            value={fields.tags}
            onChange={set('tags')}
            placeholder="Comma-separated tags"
            spellCheck={false}
          />
        </div>
        <div className="TypesView-field">
          <label className="TypesView-label">AI Instructions — Claude</label>
          <textarea
            className="TypesView-textarea"
            value={fields.claude}
            onChange={set('claude')}
            rows={6}
            placeholder="Guidance for Claude on when and how to use this type"
          />
        </div>
      </div>
      <div className="TypesView-toolbar">
        {saveError && <span className="TypesView-error">{saveError}</span>}
        {saveOk && <span className="TypesView-ok">Saved</span>}
        <div className="TypesView-toolbar-actions">
          <button className="TypesView-btn TypesView-btn--primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail pane ─────────────────────────────────────────────────────────────

interface DetailPaneProps {
  type: TypeDefinition;
  schema: string;
  onSchemaChange: (s: string) => void;
  initialTab?: Tab;
}

function DetailPane({ type, schema, onSchemaChange, initialTab = 'view' }: DetailPaneProps) {
  const { getApi } = useWorkspaceStore();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editText, setEditText] = useState(schema);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [itemMeta, setItemMeta] = useState<string>('');
  const [validateResults, setValidateResults] = useState<{ ok: boolean; message: string }[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditText(schema); setSaveError(null); setSaveOk(false); setValidateResults([]);
  }, [schema, type.id]);

  useEffect(() => {
    if (tab !== 'item') return;
    getApi().types.metadata(type.id)
      .then((m) => setItemMeta(JSON.stringify(m, null, 2)))
      .catch((e: Error) => setItemMeta(`Error: ${e.message}`));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, type.id]);

  const handleSave = async () => {
    setSaveError(null); setSaveOk(false);
    const { result, error: parseError } = prettify(editText);
    if (parseError) { setSaveError(parseError); return; }
    const schemaError = validateTypeDef(result);
    if (schemaError) { setSaveError(schemaError); return; }
    setEditText(result);
    try {
      await getApi().types.saveSchema(type.id, JSON.parse(result));
      onSchemaChange(result);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (e) { setSaveError((e as Error).message); }
  };

  const handlePrettify = () => {
    const { result, error } = prettify(editText);
    if (error) { setSaveError(error); return; }
    setEditText(result); setSaveError(null);
  };

  const handleValidate = () => {
    const results: { ok: boolean; message: string }[] = [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
      results.push({ ok: true, message: 'Valid JSON' });
    } catch (e) {
      results.push({ ok: false, message: `Invalid JSON: ${(e as Error).message}` });
      setValidateResults(results);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      results.push({ ok: false, message: 'Root must be a JSON object' });
      setValidateResults(results);
      return;
    }
    const obj = parsed as Record<string, unknown>;
    if (obj['meta'] && typeof obj['meta'] === 'object' && !Array.isArray(obj['meta'])) {
      results.push({ ok: true, message: 'Has "meta" object' });
    } else {
      results.push({ ok: false, message: 'Missing required "meta" object' });
    }
    if (obj['jsonSchema'] && typeof obj['jsonSchema'] === 'object' && !Array.isArray(obj['jsonSchema'])) {
      results.push({ ok: true, message: 'Has "jsonSchema" object' });
      const ajv = new Ajv({ allErrors: true });
      const valid = ajv.validateSchema(obj['jsonSchema'] as object);
      if (valid) {
        results.push({ ok: true, message: '"jsonSchema" is a valid JSON Schema' });
      } else {
        for (const err of ajv.errors ?? []) {
          results.push({ ok: false, message: `jsonSchema${(err as Record<string, string>).instancePath || ''}: ${err.message}` });
        }
      }
    } else {
      results.push({ ok: false, message: 'Missing required "jsonSchema" object' });
    }
    setValidateResults(results);
  };

  const TAB_LABELS: Record<Tab, string> = {
    item: 'Item', view: 'View', meta: 'Meta', 'meta-edit': 'Meta Edit', schema: 'Schema', edit: 'Edit', reference: 'Reference',
  };

  return (
    <div className="TypesView-detail">
      <div className="TypesView-tabs">
        {(['view', 'item', 'meta', 'meta-edit', 'schema', 'edit', 'reference'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`TypesView-tab${tab === t ? ' TypesView-tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="TypesView-tabcontent">
        {tab === 'item' && (
          <textarea className="TypesView-schema" value={itemMeta} readOnly spellCheck={false} />
        )}

        {tab === 'view' && (
          <textarea className="TypesView-schema" value={schema} readOnly spellCheck={false} />
        )}

        {tab === 'meta' && (
          <textarea className="TypesView-schema" value={extractSection(schema, 'meta')} readOnly spellCheck={false} />
        )}

        {tab === 'meta-edit' && (
          <MetaEditor key={type.id} typeId={type.id} schema={schema} onSchemaChange={onSchemaChange} />
        )}

        {tab === 'schema' && (
          <textarea className="TypesView-schema" value={extractSection(schema, 'jsonSchema')} readOnly spellCheck={false} />
        )}

        {tab === 'reference' && (
          <textarea className="TypesView-schema" value={typeSpecRaw} readOnly spellCheck={false} />
        )}

        {tab === 'edit' && (
          <div className="TypesView-editwrap">
            <textarea
              className="TypesView-schema TypesView-schema--editable"
              value={editText}
              onChange={(e) => { setEditText(e.target.value); setSaveError(null); setSaveOk(false); setValidateResults([]); }}
              spellCheck={false}
            />
            {validateResults.length > 0 && (
              <div className="TypesView-validate">
                {validateResults.map((r, i) => (
                  <div key={i} className={`TypesView-validate-item TypesView-validate-item--${r.ok ? 'ok' : 'error'}`}>
                    {r.ok ? '✓' : '✗'} {r.message}
                  </div>
                ))}
              </div>
            )}
            <div className="TypesView-toolbar">
              {saveError && <span className="TypesView-error">{saveError}</span>}
              {saveOk && <span className="TypesView-ok">Saved</span>}
              <div className="TypesView-toolbar-actions">
                <button className="TypesView-btn" onClick={handleValidate}>Validate Schema</button>
                <button className="TypesView-btn" onClick={handlePrettify}>Prettify</button>
                <button className="TypesView-btn TypesView-btn--primary" onClick={handleSave}>Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root view ────────────────────────────────────────────────────────────────

export function TypesView() {
  const { setItemId } = useViewLocation(TypesViewMeta.uuid);
  const { getApi } = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<TypeDefinition | null>(null);
  const [selectedInitialTab, setSelectedInitialTab] = useState<Tab>('view');
  const [schema, setSchema] = useState<string>('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const handleSelect = async (t: TypeDefinition) => {
    setSelectedType(t);
    setItemId(t.id);
    setSelectedInitialTab('view');
    try {
      const s = await getApi().types.schema(t.id);
      setSchema(JSON.stringify(s, null, 2));
    } catch { setSchema(''); }
  };

  const handleStartAdding = () => {
    setAdding(true);
    setNewName('');
    setAddError(null);
    setTimeout(() => addInputRef.current?.focus(), 0);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setAddError(null);
    try {
      const newType = await getApi().types.create(newName.trim());
      await queryClient.invalidateQueries({ queryKey: ['types'] });
      const initialSchema = JSON.stringify({
        meta: {
          icon: '',
          description: '',
          details: '',
          keywords: '',
          tags: '',
          'ai-instructions': { claude: '' },
        },
        jsonSchema: {
          '$schema': 'http://json-schema.org/draft-07/schema#',
          '$id': '',
          title: newName.trim(),
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      }, null, 2);
      setAdding(false);
      setNewName('');
      setSelectedType(newType);
      setSelectedInitialTab('edit');
      setSchema(initialSchema);
    } catch (e) {
      setAddError((e as Error).message);
    }
  };

  return (
    <div className="TypesView">
      <div className="TypesView-toolbar">
        <button className="TypesView-btn TypesView-btn--auto TypesView-btn--icon" disabled onClick={() => setSyncOpen(true)}>
          <SyncIcon className="TypesView-btn-icon" />
          Sync types
        </button>
      </div>
      <SyncTypesDialog open={syncOpen} onClose={() => setSyncOpen(false)} />
      <div className="TypesView-columns">
      <div className="TypesView-list">
        <TypeList
          selectedTypeId={selectedType?.id ?? null}
          onSelect={(t) => void handleSelect(t)}
          onCreateItem={(t) => void getApi().items.create({ value: `New ${t.value}`, type: t.value as ItemType })}
          headerActions={
            <button className="TypesView-btn" onClick={handleStartAdding} title="New type">+</button>
          }
          extraControls={adding || addError ? (
            <>
              {adding && (
                <div className="TypesView-filterrow">
                  <input
                    ref={addInputRef}
                    className="TypesView-filterinput"
                    placeholder="Type name…"
                    value={newName}
                    onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setAdding(false); }}
                  />
                  <button className="TypesView-btn TypesView-btn--primary" onClick={() => void handleCreate()}>Create</button>
                  <button className="TypesView-btn" onClick={() => setAdding(false)}>✕</button>
                </div>
              )}
              {addError && <span className="TypesView-error">{addError}</span>}
            </>
          ) : undefined}
        />
      </div>
      {selectedType ? (
        <DetailPane key={`${selectedType.id}-${selectedInitialTab}`} type={selectedType} schema={schema} onSchemaChange={setSchema} initialTab={selectedInitialTab} />
      ) : (
        <div className="TypesView-detail TypesView-detail--empty">
          <div className="TypesView-placeholder">Select a type to view its schema</div>
        </div>
      )}
      </div>
    </div>
  );
}
