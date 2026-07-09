import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import GridOnIcon from '@mui/icons-material/GridOn';
import DownloadIcon from '@mui/icons-material/Download';
import { ItemValue } from './ItemValue';
import type { KanectaItem } from '../types';
import './NodeContent.scss';

/**
 * A host-supplied resolver mapping a media item to a displayable URL
 * (`data:`, `blob:`, `http(s):`, or a root-relative path). This is the seam an
 * app uses to back `image`/`file` nodes with real file bytes — e.g. an object
 * URL read from the datastore's file store. When it returns nothing (or is not
 * provided), NodeContent falls back to `item.value` if that already holds such
 * a URL, so nodes whose value IS a URL/data-URI render with no host wiring.
 */
export type ResolveMediaUrl = (item: KanectaItem) => string | undefined;

const DISPLAYABLE_URL = /^(?:data:|blob:|https?:\/\/|\/)/i;

function mediaUrl(item: KanectaItem, resolve?: ResolveMediaUrl): string | undefined {
  const resolved = resolve?.(item);
  if (resolved) return resolved;
  const v = typeof item.value === 'string' ? item.value.trim() : '';
  return DISPLAYABLE_URL.test(v) ? v : undefined;
}

/** A human filename from a file item's value (a path/URL or a bare name). */
function fileName(value: string): string {
  if (!value) return 'file';
  const base = value.split(/[?#]/)[0].split('/').pop();
  return base || value;
}

interface NodeContentProps {
  item: KanectaItem;
  resolveId?: (id: string) => KanectaItem | undefined;
  onNavigate?: (id: string) => void;
  resolveMediaUrl?: ResolveMediaUrl;
}

/**
 * Renders a tree node's inline content, choosing a rich representation by item
 * type — an `<img>` for `image`, a download affordance for `file`, a grid
 * affordance for `grid` — and falling back to the text/markdown `ItemValue` for
 * everything else (and for media whose source cannot be resolved). This mirrors
 * the per-type `TYPE_ICONS` pattern but for node BODY content, and is the seam
 * the ~15-years-ago Connector rich-node rendering is being restored onto.
 */
export function NodeContent({ item, resolveId, onNavigate, resolveMediaUrl }: NodeContentProps) {
  const type = item._synthetic ? 'text' : item.type;
  const text = <ItemValue value={item.value} resolveId={resolveId} onNavigate={onNavigate} />;

  if (type === 'image') {
    const src = mediaUrl(item, resolveMediaUrl);
    if (!src) return text;
    return (
      <img
        className="NodeContent-image"
        src={src}
        alt={item.value || 'image'}
        loading="lazy"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  if (type === 'file') {
    const href = mediaUrl(item, resolveMediaUrl);
    const name = fileName(item.value);
    return (
      <span className="NodeContent-file">
        <InsertDriveFileIcon className="NodeContent-file-icon" fontSize="inherit" />
        <span className="NodeContent-file-name">{name}</span>
        {href && (
          <a
            className="NodeContent-file-download"
            href={href}
            download={name}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Download ${name}`}
          >
            <DownloadIcon fontSize="inherit" />
          </a>
        )}
      </span>
    );
  }

  if (type === 'grid') {
    // Inline cell layout needs the grid's cell children, which the tree node
    // does not yet carry — render a labelled grid affordance for now (full
    // cell rendering is a follow-up alongside the file-bytes backend seam).
    return (
      <span className="NodeContent-grid">
        <GridOnIcon className="NodeContent-grid-icon" fontSize="inherit" />
        {text}
      </span>
    );
  }

  return text;
}
