import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, Box,
  IconButton, Tooltip, CircularProgress,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import type { KanectaItem } from '../../../types/kanecta';

type TreeEntry = { item: KanectaItem; depth: number };

interface CopyAsDialogProps {
  item: KanectaItem | null;
  open: boolean;
  onClose: () => void;
  fetchTree: (id: string) => Promise<TreeEntry[]>;
}

const TAB_LABELS = [
  'Plain text',
  'Compressed text',
  'Tree text',
  'Markdown — todo',
  'Markdown — headings',
  'Markdown — table',
  'Markdown — nested bullets',
  'JSON',
  'Code block',
] as const;

function plainText(root: KanectaItem, entries: TreeEntry[]): string {
  return [root.value, ...entries.map(({ item, depth }) => '  '.repeat(depth) + item.value)].join('\n');
}

function compressedText(root: KanectaItem, entries: TreeEntry[]): string {
  return [root.value, ...entries.map((e) => e.item.value)].join(' | ');
}

function treeText(root: KanectaItem, entries: TreeEntry[]): string {
  const lines: string[] = [root.value];
  for (let i = 0; i < entries.length; i++) {
    const { item, depth } = entries[i];
    let isLastChild = true;
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].depth < depth) break;
      if (entries[j].depth === depth) { isLastChild = false; break; }
    }
    let prefix = '';
    for (let col = 1; col < depth; col++) {
      let hasContinuation = false;
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].depth < col) break;
        if (entries[j].depth === col) { hasContinuation = true; break; }
      }
      prefix += hasContinuation ? '│   ' : '    ';
    }
    lines.push(prefix + (isLastChild ? '└── ' : '├── ') + item.value);
  }
  return lines.join('\n');
}

function markdownHeadings(root: KanectaItem, entries: TreeEntry[]): string {
  return [
    `# ${root.value}`,
    ...entries.map(({ item, depth }) => `${'#'.repeat(Math.min(depth + 1, 6))} ${item.value}`),
  ].join('\n');
}

function markdownTable(root: KanectaItem, entries: TreeEntry[]): string {
  const rows = [{ item: root, depth: 0 }, ...entries].map(
    ({ item }) => `| ${item.value} | ${item.type} | \`${item.id}\` |`,
  );
  return ['| Value | Type | ID |', '|---|---|---|', ...rows].join('\n');
}

function markdownBullets(root: KanectaItem, entries: TreeEntry[]): string {
  return [
    `- ${root.value}`,
    ...entries.map(({ item, depth }) => '  '.repeat(depth) + `- ${item.value}`),
  ].join('\n');
}

function jsonView(root: KanectaItem, entries: TreeEntry[]): string {
  type Node = { id: string; value: string; type: string; children: Node[] };
  const nodeMap = new Map<string, Node>();
  const rootNode: Node = { id: root.id, value: root.value, type: root.type, children: [] };
  nodeMap.set(root.id, rootNode);

  for (const { item } of entries) {
    nodeMap.set(item.id, { id: item.id, value: item.value, type: item.type, children: [] });
  }

  for (let i = 0; i < entries.length; i++) {
    const { item, depth } = entries[i];
    // parent is the last entry before this one with depth - 1, or root if depth === 1
    if (depth === 1) {
      rootNode.children.push(nodeMap.get(item.id)!);
    } else {
      for (let j = i - 1; j >= 0; j--) {
        if (entries[j].depth === depth - 1) {
          nodeMap.get(entries[j].item.id)!.children.push(nodeMap.get(item.id)!);
          break;
        }
      }
    }
  }

  return JSON.stringify(rootNode, null, 2);
}

function markdownTodo(root: KanectaItem, entries: TreeEntry[]): string {
  return [
    `- [ ] ${root.value}`,
    ...entries.map(({ item, depth }) => '  '.repeat(depth) + `- [ ] ${item.value}`),
  ].join('\n');
}

function codeBlock(root: KanectaItem, entries: TreeEntry[]): string {
  return `\`\`\`\n${treeText(root, entries)}\n\`\`\``;
}

const RENDERERS = [plainText, compressedText, treeText, markdownTodo, markdownHeadings, markdownTable, markdownBullets, jsonView, codeBlock];

const LEVEL_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5', value: 5 },
  { label: '∞', value: null },
];

export function CopyAsDialog({ item, open, onClose, fetchTree }: CopyAsDialogProps) {
  const [tab, setTab] = useState(0);
  const [allEntries, setAllEntries] = useState<TreeEntry[]>([]);
  const [maxDepth, setMaxDepth] = useState<number | null>(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);
    setAllEntries([]);
    setMaxDepth(3);
    fetchTree(item.id)
      .then((data) => setAllEntries(data.filter((e) => e.depth > 0)))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [open, item, fetchTree]);

  const entries = maxDepth === null ? allEntries : allEntries.filter((e) => e.depth < maxDepth);
  const content = item && !loading && !error ? RENDERERS[tab](item, entries) : '';

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      onClick={(e) => e.stopPropagation()}
      PaperProps={{ sx: { width: '80vw', height: '80vh', display: 'flex', flexDirection: 'column' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <span>Copy as</span>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title={copied ? 'Copied!' : 'Copy'}>
            <span>
              <IconButton onClick={handleCopy} disabled={loading || !item || error} size="small">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginRight: 4 }}>Levels</span>
        {LEVEL_OPTIONS.map(({ label, value }) => {
          const active = maxDepth === value;
          return (
            <button
              key={label}
              onClick={() => setMaxDepth(value)}
              style={{
                fontSize: '0.75rem',
                fontWeight: active ? 600 : 400,
                padding: '2px 10px',
                borderRadius: '999px',
                border: `1px solid ${active ? '#1976d2' : 'rgba(0,0,0,0.2)'}`,
                background: active ? '#1976d2' : 'transparent',
                color: active ? '#fff' : 'inherit',
                cursor: 'pointer',
                lineHeight: '1.6',
              }}
            >
              {label}
            </button>
          );
        })}
      </Box>

      <DialogContent sx={{ flex: 1, display: 'flex', flexDirection: 'row', p: 0, overflow: 'hidden' }}>
        {/* Left sidebar: format list */}
        <Box
          sx={{
            width: 180,
            flexShrink: 0,
            borderRight: 1,
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            py: 1,
          }}
        >
          {TAB_LABELS.map((label, i) => (
            <button
              key={label}
              onClick={() => setTab(i)}
              style={{
                textAlign: 'left',
                background: tab === i ? 'rgba(25,118,210,0.1)' : 'transparent',
                border: 'none',
                borderLeft: tab === i ? '3px solid #1976d2' : '3px solid transparent',
                color: tab === i ? '#1976d2' : 'inherit',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: tab === i ? 600 : 400,
                padding: '8px 16px',
                width: '100%',
              }}
            >
              {label}
            </button>
          ))}
        </Box>

        {/* Right: content area */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2, overflow: 'hidden' }}>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {error && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, color: 'error.main', fontSize: '0.875rem' }}>
              Failed to load tree data
            </Box>
          )}
          {!loading && !error && (
            <textarea
              readOnly
              value={content}
              style={{
                flex: 1,
                width: '100%',
                resize: 'none',
                fontFamily: 'monospace',
                fontSize: '13px',
                lineHeight: '1.5',
                border: '1px solid var(--color-border, rgba(0,0,0,0.15))',
                borderRadius: '4px',
                padding: '10px',
                background: 'var(--color-bg-secondary, rgba(0,0,0,0.03))',
                color: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
