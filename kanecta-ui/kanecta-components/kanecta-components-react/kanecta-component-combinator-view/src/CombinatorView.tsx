import { useState, useMemo } from 'react';
import Slider from '@mui/material/Slider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import './CombinatorView.css';

export interface CombinatorItem {
  id: string;
  value: string;
  type: string;
}

export interface CombinatorSubtreeEntry {
  item: CombinatorItem;
  depth: number;
}

function buildPrompt(
  goal: string,
  inputs: CombinatorItem[],
  subtrees: Record<string, CombinatorSubtreeEntry[]>,
): string {
  const lines: string[] = [];
  lines.push('# Goal', '');
  if (goal.trim()) lines.push(goal.trim(), '');
  lines.push('# Inputs', '');
  for (const input of inputs) {
    lines.push(`## ${input.value}`, '');
    const tree = subtrees[input.id] ?? [];
    for (const { item, depth } of tree) {
      if (depth === 0) continue;
      lines.push(`${'  '.repeat(depth - 1)}- ${item.value}`);
    }
    lines.push('');
  }
  lines.push(
    '# Additional instructions',
    '',
    'Resolve the double square bracket, uuid, wikilinks using Kanecta eg "[[00000000-0000-0000-0000-000000000000]]"',
  );
  return lines.join('\n').trimEnd();
}

export interface CombinatorViewProps {
  onGetItem: (id: string) => Promise<CombinatorItem>;
  onGetTree: (id: string) => Promise<CombinatorSubtreeEntry[]>;
  getTypeIcon?: (type: string) => React.ElementType<{ className?: string }> | undefined;
  starredPanel?: React.ReactNode;
  clipboardHistoryPanel?: React.ReactNode;
  navigationHistoryPanel?: React.ReactNode;
}

export function CombinatorView({
  onGetItem,
  onGetTree,
  getTypeIcon,
  starredPanel,
  clipboardHistoryPanel,
  navigationHistoryPanel,
}: CombinatorViewProps) {
  const [verbosity, setVerbosity] = useState<number>(50);
  const [includeInputs, setIncludeInputs] = useState(true);
  const [renderTree, setRenderTree] = useState(true);
  const [followLinks, setFollowLinks] = useState(true);
  const [inputs, setInputs] = useState<CombinatorItem[]>([]);
  const [subtrees, setSubtrees] = useState<Record<string, CombinatorSubtreeEntry[]>>({});
  const [goalText, setGoalText] = useState('');
  const [uuidInput, setUuidInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const prompt = useMemo(
    () => buildPrompt(goalText, inputs, subtrees),
    [goalText, inputs, subtrees],
  );

  const handleAddInput = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const id = uuidInput.trim();
    if (!id) return;
    if (inputs.some((i) => i.id === id)) { setInputError('Already added'); return; }
    setInputError(null);
    try {
      const [item, tree] = await Promise.all([onGetItem(id), onGetTree(id)]);
      setInputs((prev) => [...prev, item]);
      setSubtrees((prev) => ({ ...prev, [id]: tree }));
      setUuidInput('');
    } catch {
      setInputError('Item not found');
    }
  };

  const handleRemoveInput = (id: string) => {
    setInputs((prev) => prev.filter((i) => i.id !== id));
    setSubtrees((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const handleCopy = () => {
    void navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="CombinatorView">
      <div className="CombinatorView-left">
        <div className="CombinatorView-box CombinatorView-box--inputs">
          <span className="CombinatorView-box-label">Inputs</span>
          <div className="CombinatorView-input-list">
            {inputs.map((item) => {
              const Icon = getTypeIcon?.(item.type);
              return (
                <div key={item.id} className="CombinatorView-input-row">
                  {Icon && <Icon className="CombinatorView-input-icon" />}
                  <span className="CombinatorView-input-name">{item.value}</span>
                  <span className="CombinatorView-input-id">{item.id}</span>
                  <button className="CombinatorView-input-remove" onClick={() => handleRemoveInput(item.id)} aria-label="Remove">✕</button>
                </div>
              );
            })}
          </div>
          <div className="CombinatorView-input-add">
            <input
              className="CombinatorView-input-field"
              placeholder="Paste UUID and press Enter…"
              value={uuidInput}
              onChange={(e) => { setUuidInput(e.target.value); setInputError(null); }}
              onKeyDown={(e) => void handleAddInput(e)}
            />
            {inputError && <span className="CombinatorView-input-error">{inputError}</span>}
          </div>
        </div>

        <div className="CombinatorView-box CombinatorView-box--goal">
          <span className="CombinatorView-box-label">Goal</span>
          <textarea
            className="CombinatorView-textarea"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
          />
        </div>

        <div className="CombinatorView-controls">
          <span className="CombinatorView-control-label">Prompt verbosity</span>
          <Slider value={verbosity} onChange={(_, v) => setVerbosity(v as number)} size="small" />
          <div className="CombinatorView-checkboxes">
            <FormControlLabel
              control={<Checkbox size="small" checked={includeInputs} onChange={(e) => setIncludeInputs(e.target.checked)} />}
              label="Include inputs"
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={renderTree} onChange={(e) => setRenderTree(e.target.checked)} />}
              label="Render entire tree"
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={followLinks} onChange={(e) => setFollowLinks(e.target.checked)} />}
              label="Follow links"
            />
          </div>
        </div>

        <div className="CombinatorView-box CombinatorView-box--prompt">
          <div className="CombinatorView-prompt-header">
            <span className="CombinatorView-box-label">AI prompt</span>
            <button className="CombinatorView-copy-btn" onClick={handleCopy} aria-label="Copy prompt">
              <ContentCopyIcon fontSize="small" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="CombinatorView-prompt-text">{prompt}</pre>
        </div>
      </div>

      <div className="CombinatorView-divider" />

      <div className="CombinatorView-right">
        {starredPanel && (
          <>
            <div className="CombinatorView-section">{starredPanel}</div>
            <div className="CombinatorView-section-divider" />
          </>
        )}
        {clipboardHistoryPanel && (
          <>
            <div className="CombinatorView-section">
              <div className="CombinatorView-section-inner">
                <h2 className="CombinatorView-heading">Clipboard History</h2>
                {clipboardHistoryPanel}
              </div>
            </div>
            <div className="CombinatorView-section-divider" />
          </>
        )}
        {navigationHistoryPanel && (
          <div className="CombinatorView-section">
            <div className="CombinatorView-section-inner">
              <h2 className="CombinatorView-heading">Navigation History</h2>
              {navigationHistoryPanel}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
