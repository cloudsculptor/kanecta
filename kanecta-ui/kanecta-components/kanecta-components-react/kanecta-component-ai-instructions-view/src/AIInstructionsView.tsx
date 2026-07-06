import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CircularProgress } from '@mui/material';
import './AIInstructionsView.scss';

export interface SkillEntry {
  id: string;
  title: string;
}

export interface SkillFile {
  content: string;
}

export interface AIInstructionsViewProps {
  listSkills: () => Promise<SkillEntry[]>;
  getSkill: (id: string) => Promise<SkillFile>;
  updateSkill: (id: string, content: string) => Promise<unknown>;
}

export function AIInstructionsView({ listSkills, getSkill, updateSkill }: AIInstructionsViewProps) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: skills = [], isLoading: listLoading } = useQuery({
    queryKey: ['ai-skills'],
    queryFn: listSkills,
  });

  const { data: skill, isLoading: fileLoading } = useQuery({
    queryKey: ['ai-skill', selectedId],
    queryFn: () => getSkill(selectedId!),
    enabled: selectedId !== null,
  });

  useEffect(() => {
    if (skills.length > 0 && selectedId === null) {
      setSelectedId(skills[0].id);
    }
  }, [skills, selectedId]);

  useEffect(() => {
    if (skill) setDraft(skill.content);
  }, [skill]);

  useEffect(() => {
    setTab('view');
  }, [selectedId]);

  const saveMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => updateSkill(id, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-skill', selectedId] });
      void qc.invalidateQueries({ queryKey: ['ai-skills'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const isDirty = skill ? draft !== skill.content : false;

  return (
    <div className="AIInstructionsView">
      <div className="AIInstructionsView-list">
        {listLoading && (
          <div className="AIInstructionsView-loading"><CircularProgress size={18} /></div>
        )}
        {skills.map((s) => (
          <button
            key={s.id}
            className={`AIInstructionsView-list-item${selectedId === s.id ? ' AIInstructionsView-list-item--active' : ''}`}
            onClick={() => setSelectedId(s.id)}
          >
            {s.title}
          </button>
        ))}
      </div>

      <div className="AIInstructionsView-content">
        <div className="AIInstructionsView-tabs">
          {(['view', 'edit'] as const).map((t) => (
            <button
              key={t}
              className={`AIInstructionsView-tab${tab === t ? ' AIInstructionsView-tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'view' ? 'View' : 'Edit'}
            </button>
          ))}
          {tab === 'edit' && (
            <button
              className={`AIInstructionsView-save${isDirty ? ' AIInstructionsView-save--dirty' : ''}`}
              disabled={!isDirty || saveMutation.isPending}
              onClick={() => { if (selectedId) saveMutation.mutate({ id: selectedId, content: draft }); }}
            >
              {saveMutation.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save'}
            </button>
          )}
        </div>

        <div className="AIInstructionsView-body">
          {fileLoading && (
            <div className="AIInstructionsView-loading"><CircularProgress size={18} /></div>
          )}
          {!fileLoading && skill && tab === 'view' && (
            <div className="AIInstructionsView-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.content}</ReactMarkdown>
            </div>
          )}
          {!fileLoading && skill && tab === 'edit' && (
            <textarea
              className="AIInstructionsView-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
          )}
          {!fileLoading && !skill && selectedId && (
            <div className="AIInstructionsView-loading">Failed to load file</div>
          )}
        </div>
      </div>
    </div>
  );
}
