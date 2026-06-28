export interface PendingFile {
  tempId: string;
  fileId?: string;
  name: string;
  mime_type: string;
  size_bytes?: number;
  url?: string;
  uploading: boolean;
  error?: string;
}

interface Props {
  files: PendingFile[];
  onRemove: (tempId: string) => void;
}

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentBar({ files, onRemove }: Props) {
  if (!files.length) return null;

  return (
    <div className="discussions-attachment-bar">
      {files.map((f) => (
        <div key={f.tempId} className={`discussions-attachment-item${f.error ? " discussions-attachment-item--error" : ""}`}>
          {f.mime_type.startsWith("image/") && f.url ? (
            <img src={f.url} alt={f.name} className="discussions-attachment-item__thumb" />
          ) : (
            <div className="discussions-attachment-item__icon">
              <IconFile />
            </div>
          )}
          <div className="discussions-attachment-item__info">
            <span className="discussions-attachment-item__name" title={f.name}>{f.name}</span>
            {f.error ? (
              <span className="discussions-attachment-item__error">{f.error}</span>
            ) : f.uploading ? (
              <span className="discussions-attachment-item__status">Uploading…</span>
            ) : (
              <span className="discussions-attachment-item__size">{formatSize(f.size_bytes)}</span>
            )}
          </div>
          <button
            className="discussions-attachment-item__remove"
            onClick={() => onRemove(f.tempId)}
            title="Remove"
            aria-label="Remove attachment"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

const IconFile = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);
