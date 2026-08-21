import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import GridOnIcon from '@mui/icons-material/GridOn';
import TableChartIcon from '@mui/icons-material/TableChart';
import DownloadIcon from '@mui/icons-material/Download';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';
import { useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ItemValue } from './ItemValue';
import { TreeViewContext } from '../context';
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

/**
 * A host-supplied fetcher for a file item's stored bytes (datastore sidecar /
 * S3 object — file bytes always live inside the datastore, never at an
 * external URL). Returns null when the item has no stored bytes. Powers the
 * download interactions: click-to-download on file rows, the hover overlay on
 * images.
 */
export type FetchFileBytes = (item: KanectaItem) => Promise<Blob | null>;

/** A human filename from a file item's value (a path/URL or a bare name). */
function fileName(value: string): string {
  if (!value) return 'file';
  const base = value.split(/[?#]/)[0].split('/').pop();
  return base || value;
}

/**
 * The stored sidecar filename a byte fetch would target (meta.files role
 * priority image → file → body, then any other role), or undefined when the
 * item has no stored bytes at all. Download affordances only render when this
 * resolves — a fetch seam alone can't download anything from a role-less item.
 */
function storedFileName(item: KanectaItem): string | undefined {
  const files = item.files ?? {};
  return files.image ?? files.file ?? files.body ?? Object.values(files)[0];
}

/** The filename a download should save as — the stored sidecar's, ideally. */
function downloadName(item: KanectaItem): string {
  return storedFileName(item) ?? fileName(item.value);
}

/** Trigger a browser save of already-fetched bytes. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface NodeContentProps {
  item: KanectaItem;
  resolveId?: (id: string) => KanectaItem | undefined;
  onNavigate?: (id: string) => void;
  resolveMediaUrl?: ResolveMediaUrl;
  /**
   * Host seam for downloading a file item's stored bytes on demand (see
   * FetchFileBytes). When present, file rows download on click (behind a
   * confirmation dialog) and images grow a hover download overlay.
   */
  fetchFileBytes?: FetchFileBytes;
  /**
   * Host seam for `table` nodes (spec §tablePayload) — the host renders the
   * inline grid (it owns ag-grid and the saved-query execution path). Absent
   * or returning nothing falls back to a labelled table affordance.
   */
  renderTable?: (item: KanectaItem) => ReactNode;
  /**
   * Internal recursion counter for symlink chains — a symlink target that is
   * itself a symlink resolves again, up to MAX_SYMLINK_DEPTH. Not a host prop.
   */
  symlinkDepth?: number;
}

/**
 * Renders a tree node's inline content, choosing a rich representation by item
 * type — an `<img>` for `image`, a download affordance for `file`, a grid
 * affordance for `grid` — and falling back to the text/markdown `ItemValue` for
 * everything else (and for media whose source cannot be resolved). This mirrors
 * the per-type `TYPE_ICONS` pattern but for node BODY content, and is the seam
 * the ~15-years-ago Connector rich-node rendering is being restored onto.
 */
export function NodeContent({ item, resolveId, onNavigate, resolveMediaUrl, fetchFileBytes, renderTable, symlinkDepth = 0 }: NodeContentProps) {
  const type = item._synthetic ? 'text' : item.type;
  const text = <ItemValue value={item.value} resolveId={resolveId} onNavigate={onNavigate} />;

  if (type === 'symlink') {
    return (
      <SymlinkContent
        item={item}
        resolveId={resolveId}
        onNavigate={onNavigate}
        resolveMediaUrl={resolveMediaUrl}
        fetchFileBytes={fetchFileBytes}
        renderTable={renderTable}
        symlinkDepth={symlinkDepth}
      />
    );
  }

  if (type === 'image') {
    const src = mediaUrl(item, resolveMediaUrl);
    if (!src) return text;
    return <ImageContent item={item} src={src} fetchFileBytes={fetchFileBytes} />;
  }

  if (type === 'file') {
    const href = mediaUrl(item, resolveMediaUrl);
    // A file item carrying an `image` sidecar role (spec §files-and-sidecars)
    // renders the picture itself; every other file renders a download row.
    if (item.files?.image && href) {
      return <ImageContent item={item} src={href} fetchFileBytes={fetchFileBytes} />;
    }
    return <FileContent item={item} href={href} fetchFileBytes={fetchFileBytes} />;
  }

  if (type === 'table') {
    const rendered = renderTable?.(item);
    if (rendered != null) {
      // Grid interactions (sort, filter, page) must not toggle/focus the node.
      return (
        <div className="NodeContent-table" onClick={(e) => e.stopPropagation()}>
          {rendered}
        </div>
      );
    }
    return (
      <span className="NodeContent-grid">
        <TableChartIcon className="NodeContent-grid-icon" fontSize="inherit" />
        {text}
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

/**
 * An inline image with a download overlay button that appears on hover when
 * the host can supply the stored bytes. Images download immediately on the
 * overlay click — the confirmation dialog is for opaque file rows, where a
 * click could otherwise trigger an accidental download of unknown bytes.
 */
function ImageContent({
  item,
  src,
  fetchFileBytes,
}: {
  item: KanectaItem;
  src: string;
  fetchFileBytes?: FetchFileBytes;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = downloadName(item);

  const img = (
    <img
      className="NodeContent-image"
      src={src}
      alt={item.value || 'image'}
      loading="lazy"
      onClick={(e) => e.stopPropagation()}
    />
  );
  // No seam, or nothing stored to fetch (an image whose src is just a URL
  // value) — a download button here would be a dead control.
  if (!fetchFileBytes || !storedFileName(item)) return img;

  const title = failed ? `Download of ${name} failed — click to retry` : `Download ${name}`;
  return (
    <span className="NodeContent-imageWrap">
      {img}
      <button
        type="button"
        className={`NodeContent-image-download${failed ? ' is-failed' : ''}`}
        title={title}
        aria-label={title}
        disabled={busy}
        onClick={async (e) => {
          e.stopPropagation();
          setBusy(true);
          try {
            const blob = await fetchFileBytes(item);
            if (blob) {
              saveBlob(blob, name);
              setFailed(false);
            } else {
              setFailed(true);
            }
          } catch (err) {
            console.error(`Download of ${name} failed`, err);
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <DownloadIcon fontSize="inherit" />
      </button>
    </span>
  );
}

/**
 * A non-image file row: icon + name + download affordance. With a
 * fetchFileBytes host seam the whole row is clickable and downloads the
 * stored bytes after an explicit confirmation dialog; without one it falls
 * back to a plain anchor when the item's value/resolver yields a URL (the
 * standalone-usage path — datastore-backed hosts always pass the seam).
 */
function FileContent({
  item,
  href,
  fetchFileBytes,
}: {
  item: KanectaItem;
  href?: string;
  fetchFileBytes?: FetchFileBytes;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = fileName(item.value);
  const storedName = storedFileName(item);

  const row = (
    <>
      <InsertDriveFileIcon className="NodeContent-file-icon" fontSize="inherit" />
      <span className="NodeContent-file-name">{name}</span>
    </>
  );

  // No seam, or nothing stored to fetch — the click-to-download row would be a
  // dead control, so fall back to the plain row (with the legacy anchor when
  // the value/resolver yields a URL).
  if (!fetchFileBytes || !storedName) {
    return (
      <span className="NodeContent-file">
        {row}
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

  // The dialog stays open until the bytes actually arrive — a failed fetch
  // shows its error in place instead of silently doing nothing.
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await fetchFileBytes(item);
      if (!blob) {
        setError('No stored bytes came back for this file — the server may not have them.');
        return;
      }
      saveBlob(blob, storedName);
      setConfirming(false);
    } catch (err) {
      console.error(`Download of ${storedName} failed`, err);
      setError(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span
      className="NodeContent-file NodeContent-file--downloadable"
      role="button"
      tabIndex={0}
      aria-label={`Download ${name}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) {
          setError(null);
          setConfirming(true);
        }
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !busy) {
          e.preventDefault();
          e.stopPropagation();
          setError(null);
          setConfirming(true);
        }
      }}
    >
      {row}
      <DownloadIcon className="NodeContent-file-downloadIcon" fontSize="inherit" />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>Download file?</DialogTitle>
        <DialogContent>
          {storedName}
          {error && <p className="NodeContent-file-error">{error}</p>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="contained" onClick={download} disabled={busy}>
            {error ? 'Retry' : 'Download'}
          </Button>
        </DialogActions>
      </Dialog>
    </span>
  );
}

const SYMLINK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Symlink chains longer than this render as broken instead of recursing. */
const MAX_SYMLINK_DEPTH = 3;

/**
 * Resolves a `symlink` node (spec §trees: item.value holds the target UUID)
 * and renders the TARGET through NodeContent's normal per-type dispatch — a
 * symlink to an image shows the image, a symlink to a table shows the host's
 * grid, and so on — prefixed with a green bullet marking it as a link rather
 * than a direct item. Clicking the bullet navigates to the target. Resolution
 * prefers the host's already-loaded items (resolveId) and falls back to
 * api.items.get. Outside a TreeView (no context) or with a non-UUID value the
 * raw value renders as plain text; a dangling target renders a broken (red)
 * bullet with the unresolvable UUID.
 */
function SymlinkContent(props: NodeContentProps) {
  const { item, resolveId, onNavigate, symlinkDepth = 0 } = props;
  const ctx = useContext(TreeViewContext);
  const targetId = typeof item.value === 'string' ? item.value.trim() : '';
  const isUuid = SYMLINK_UUID_RE.test(targetId);
  const local = isUuid ? resolveId?.(targetId) : undefined;

  if (!isUuid) {
    return <ItemValue value={item.value} resolveId={resolveId} onNavigate={onNavigate} />;
  }
  // A too-deep chain renders broken even when the target IS resolvable — a
  // symlink cycle would otherwise recurse forever.
  if (symlinkDepth >= MAX_SYMLINK_DEPTH) {
    return <SymlinkBody {...props} targetId={targetId} broken />;
  }
  if (local) {
    return <SymlinkBody {...props} targetId={targetId} target={local} />;
  }
  // Fetching needs the TreeView context (and its QueryClient — TreeView hosts
  // always provide one; standalone/story usage of NodeContent may not, which
  // is why useQuery lives in the child that only mounts here).
  if (!ctx) {
    return <ItemValue value={item.value} resolveId={resolveId} onNavigate={onNavigate} />;
  }
  return <SymlinkRemote {...props} targetId={targetId} />;
}

/** Resolves the symlink target through the TreeView API via react-query. */
function SymlinkRemote(props: NodeContentProps & { targetId: string }) {
  const ctx = useContext(TreeViewContext);
  const { targetId } = props;
  const { data, isPending, isError } = useQuery({
    queryKey: ['symlink-target', targetId],
    queryFn: () => ctx!.api.items.get(targetId),
    retry: false,
  });
  if (isPending) return <SymlinkBody {...props} pending />;
  if (isError || !data) return <SymlinkBody {...props} broken />;
  return <SymlinkBody {...props} target={data} />;
}

/** Green (or broken-red) bullet plus the resolved target's own rendering. */
function SymlinkBody({
  target,
  targetId,
  broken = false,
  pending = false,
  resolveId,
  onNavigate,
  resolveMediaUrl,
  fetchFileBytes,
  renderTable,
  symlinkDepth = 0,
}: Omit<NodeContentProps, 'item'> & {
  target?: KanectaItem;
  targetId: string;
  broken?: boolean;
  pending?: boolean;
}) {
  const title = broken
    ? `Broken symlink → ${targetId}`
    : `Symlink → ${target?.value || targetId}${target ? ' — click to open the target' : ''}`;
  return (
    <span className="NodeContent-symlink">
      <span
        className={`NodeContent-symlink-bullet${broken ? ' is-broken' : ''}`}
        title={title}
        aria-label={title}
        role={target && onNavigate ? 'button' : undefined}
        onClick={
          target && onNavigate
            ? (e) => {
                e.stopPropagation();
                onNavigate(target.id);
              }
            : undefined
        }
      />
      <span className="NodeContent-symlink-target">
        {target && !broken ? (
          <NodeContent
            item={target}
            resolveId={resolveId}
            onNavigate={onNavigate}
            resolveMediaUrl={resolveMediaUrl}
            fetchFileBytes={fetchFileBytes}
            renderTable={renderTable}
            symlinkDepth={symlinkDepth + 1}
          />
        ) : (
          <span className={pending ? 'NodeContent-symlink-pending' : 'NodeContent-symlink-broken'}>
            {targetId}
          </span>
        )}
      </span>
    </span>
  );
}
