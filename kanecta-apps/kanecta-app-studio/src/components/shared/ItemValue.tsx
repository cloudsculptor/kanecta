import type { KanectaItem } from '../../types/kanecta';
import './ItemValue.scss';

const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;

type Segment =
  | { kind: 'text';     text: string }
  | { kind: 'wikilink'; uuid: string; label?: string }
  | { kind: 'url';      href: string }
  | { kind: 'code';     text: string }
  | { kind: 'bold';     text: string }
  | { kind: 'italic';   text: string };

// Matches https?:// URLs, [[uuid|label]], [[uuid]], `code`, **bold**, *italic*
const TOKEN_RE = /(https?:\/\/[^\s<>[\]]+)|\[\[([a-f0-9-]{36})(?:\|([^\]]*))?\]\]|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function parse(value: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(value)) !== null) {
    if (match.index > last) {
      segments.push({ kind: 'text', text: value.slice(last, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: 'url', href: match[1] });
    } else if (match[2] !== undefined && UUID_RE.test(match[2])) {
      segments.push({ kind: 'wikilink', uuid: match[2], label: match[3] });
    } else if (match[4] !== undefined) {
      segments.push({ kind: 'code', text: match[4] });
    } else if (match[5] !== undefined) {
      segments.push({ kind: 'bold', text: match[5] });
    } else if (match[6] !== undefined) {
      segments.push({ kind: 'italic', text: match[6] });
    }
    last = match.index + match[0].length;
  }

  if (last < value.length) {
    segments.push({ kind: 'text', text: value.slice(last) });
  }
  return segments;
}

interface ItemValueProps {
  value: string;
  resolveId?: (id: string) => KanectaItem | undefined;
  onNavigate?: (id: string) => void;
  className?: string;
}

export function ItemValue({ value, resolveId, onNavigate, className }: ItemValueProps) {
  if (!value) return null;

  const segments = parse(value);

  return (
    <span className={`ItemValue${className ? ` ${className}` : ''}`}>
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case 'url':
            return (
              <a
                key={i}
                href={seg.href}
                className="ItemValue-url"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {seg.href}
              </a>
            );
          case 'code':
            return <code key={i} className="ItemValue-code">{seg.text}</code>;
          case 'bold':
            return <strong key={i}>{seg.text}</strong>;
          case 'italic':
            return <em key={i}>{seg.text}</em>;
          case 'wikilink': {
            const resolved = resolveId?.(seg.uuid);
            const label = seg.label ?? resolved?.value ?? seg.uuid.slice(0, 8) + '…';
            return (
              <span
                key={i}
                className={`ItemValue-link${resolved ? '' : ' ItemValue-link--unresolved'}`}
                title={seg.uuid}
                onClick={onNavigate ? (e) => { e.stopPropagation(); onNavigate(seg.uuid); } : undefined}
                role={onNavigate ? 'link' : undefined}
                tabIndex={onNavigate ? 0 : undefined}
                onKeyDown={onNavigate ? (e) => { if (e.key === 'Enter') onNavigate(seg.uuid); } : undefined}
              >
                {label}
              </span>
            );
          }
          default:
            return <span key={i}>{seg.text}</span>;
        }
      })}
    </span>
  );
}
