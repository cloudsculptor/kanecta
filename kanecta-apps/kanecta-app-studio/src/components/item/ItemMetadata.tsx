import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TagChip } from '../shared/TagChip';
import { useWorkspaceStore } from '../../store/workspace';
import { ITEM_TYPES, CONFIDENCE_LEVELS } from '../../lib/constants';
import type { KanectaItem } from '../../types/kanecta';
import './ItemMetadata.scss';

interface ItemMetadataProps {
  item: KanectaItem;
}

type EditableField = 'value' | 'type' | 'confidence' | 'tags' | null;

export function ItemMetadata({ item }: ItemMetadataProps) {
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();
  const [editingField, setEditingField] = useState<EditableField>(null);
  const [draft, setDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');

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
    mutation.mutate({ type: e.target.value as KanectaItem['type'] });
  };

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
            {item.value}
          </div>
        )}
      </div>

      <div className="ItemMetadata-row">
        <span className="ItemMetadata-label">Type</span>
        <select
          className="ItemMetadata-select"
          value={item.type}
          onChange={handleTypeChange}
          aria-label="Item type"
        >
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
      </div>
    </div>
  );
}
