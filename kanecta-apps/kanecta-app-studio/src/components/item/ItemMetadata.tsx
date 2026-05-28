import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { TagChip } from '../shared/TagChip';
import { ItemValue } from '../shared/ItemValue';
import { useWorkspaceStore } from '../../store/workspace';
import { useItemLookup } from '../../hooks/useItemLookup';
import { ITEM_TYPES, CONFIDENCE_LEVELS } from '../../lib/constants';
import type { KanectaItem } from '../../types/kanecta';
import './ItemMetadata.scss';

const TOP_TYPES = ['text', 'number', 'heading', 'url', 'file', 'image', 'code', 'object'];
const OTHER_TYPES = ITEM_TYPES.filter((t) => !TOP_TYPES.includes(t));

interface ItemMetadataProps {
  item: KanectaItem;
}

type EditableField = 'value' | 'type' | 'confidence' | 'tags' | null;

function CopyButton({ text, onAfterCopy }: { text: string; onAfterCopy?: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    onAfterCopy?.();
  };

  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
      <IconButton size="small" onClick={handleCopy} className="ItemMetadata-copy">
        <ContentCopyIcon sx={{ fontSize: 13 }} />
      </IconButton>
    </Tooltip>
  );
}

export function ItemMetadata({ item }: ItemMetadataProps) {
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();
  const resolveId = useItemLookup();
  const [editingField, setEditingField] = useState<EditableField>(null);
  const [draft, setDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');

  const { data: customTypes = [] } = useQuery({
    queryKey: ['types'],
    queryFn: () => getApi().types.list(),
  });

  const mutation = useMutation({
    mutationFn: (changes: Partial<KanectaItem>) => getApi().items.update(item.id, changes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['all-items'] });
      void qc.invalidateQueries({ queryKey: ['item', item.id] });
    },
  });

  const startEdit = (field: EditableField, current: string) => {
    setEditingField(field);
    setDraft(current);
  };

  const commit = (field: EditableField) => {
    if (field === 'value' && draft.trim() !== item.value) {
      mutation.mutate({ value: draft.trim() });
    }
    setEditingField(null);
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val.startsWith('custom:')) {
      mutation.mutate({ typeId: val.slice(7) });
    } else {
      mutation.mutate({ type: val as KanectaItem['type'], typeId: null });
    }
  };

  const typeSelectValue = item.typeId && customTypes.find((t) => t.id === item.typeId)
    ? `custom:${item.typeId}`
    : item.type;

  const handleConfidenceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    mutation.mutate({ confidence: val === '' ? null : (val as KanectaItem['confidence']) });
  };

  const addTag = (tag: string) => {
    const cleaned = tag.trim().toLowerCase();
    if (cleaned && !item.tags.includes(cleaned)) {
      mutation.mutate({ tags: [...item.tags, cleaned] });
    }
    setTagDraft('');
  };

  const removeTag = (tag: string) => {
    mutation.mutate({ tags: item.tags.filter((t) => t !== tag) });
  };

  return (
    <div className="ItemMetadata">
      <div className="ItemMetadata-row">
        <span className="ItemMetadata-label">Value</span>
        {editingField === 'value' ? (
          <input
            className="ItemMetadata-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit('value')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit('value');
              if (e.key === 'Escape') setEditingField(null);
            }}
          />
        ) : (
          <div
            className="ItemMetadata-value ItemMetadata-value--editable"
            onClick={() => startEdit('value', item.value)}
            title="Click to edit"
          >
            <ItemValue value={item.value} resolveId={resolveId} />
          </div>
        )}
        <CopyButton text={item.value} />
      </div>

      <div className="ItemMetadata-row">
        <span className="ItemMetadata-label">Type</span>
        <select
          className="ItemMetadata-select"
          value={typeSelectValue}
          onChange={handleTypeChange}
          aria-label="Item type"
        >
          <optgroup label="Primitive">
            {TOP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </optgroup>
          <optgroup label="AI">
            {OTHER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </optgroup>
          {customTypes.length > 0 && (
            <optgroup label="Custom types">
              {[...customTypes].sort((a, b) => a.value.localeCompare(b.value)).map((t) => (
                <option key={t.id} value={`custom:${t.id}`}>{t.value}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="ItemMetadata-row">
        <span className="ItemMetadata-label">Confidence</span>
        <select
          className="ItemMetadata-select"
          value={item.confidence ?? ''}
          onChange={handleConfidenceChange}
          aria-label="Confidence level"
        >
          <option value="">— unset —</option>
          {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="ItemMetadata-row">
        <span className="ItemMetadata-label">Tags</span>
        <div className="ItemMetadata-tags">
          {item.tags.map((t) => (
            <TagChip key={t} tag={t} onRemove={() => removeTag(t)} />
          ))}
          <input
            className="ItemMetadata-tag-input"
            placeholder="add tag…"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(tagDraft);
              }
            }}
            onBlur={() => { if (tagDraft.trim()) addTag(tagDraft); }}
            aria-label="Add tag"
          />
        </div>
      </div>

      <div className="ItemMetadata-row">
        <span className="ItemMetadata-label">ID</span>
        <div className="ItemMetadata-value" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
          {item.id}
        </div>
        <CopyButton text={item.id} onAfterCopy={() => void getApi(activeWorkspaceId).breadcrumb.addClipboard(item.id, item.value)} />
      </div>
    </div>
  );
}
