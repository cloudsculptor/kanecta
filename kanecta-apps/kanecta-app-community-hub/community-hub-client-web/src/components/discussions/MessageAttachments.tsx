import { useState } from "react";
import type { MessageFile } from "../../api/discussions";
import { api } from "../../api/discussions";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  files: MessageFile[];
  canDelete: boolean;
}

export default function MessageAttachments({ files, canDelete }: Props) {
  const [localFiles, setLocalFiles] = useState<MessageFile[]>(files);

  async function handleDelete(fileId: string) {
    try {
      await api.files.delete(fileId);
      setLocalFiles(prev => prev.filter(f => f.file_id !== fileId));
    } catch { /* ignore */ }
  }

  async function handleDownload(fileId: string, fileName: string) {
    try { await api.files.download(fileId, fileName); } catch { /* ignore */ }
  }

  async function handleTogglePreview(mf: MessageFile) {
    try {
      await api.files.togglePreview(mf.id, !mf.show_preview);
      setLocalFiles(prev => prev.map(f => f.id === mf.id ? { ...f, show_preview: !f.show_preview } : f));
    } catch { /* ignore */ }
  }

  if (!localFiles.length) return null;

  return (
    <div className="discussions-message-files">
      {localFiles.map(f => {
        const isImage = f.mime_type.startsWith("image/");
        return (
          <div key={f.id} className="discussions-message-file">
            {isImage ? (
              f.show_preview ? (
                <div className="discussions-message-file__image-wrap">
                  <img src={f.url} alt={f.name} className="discussions-message-file__image" />
                  <div className="discussions-message-file__image-actions">
                    <button
                      className="discussions-message-file__btn"
                      title="Hide preview"
                      onClick={() => handleTogglePreview(f)}
                    >×</button>
                    {canDelete && (
                      <button
                        className="discussions-message-file__btn discussions-message-file__btn--delete"
                        title="Delete file"
                        onClick={() => handleDelete(f.file_id)}
                      >🗑</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="discussions-message-file__chip">
                  <span className="discussions-message-file__chip-name">{f.name}</span>
                  <button
                    className="discussions-message-file__chip-show"
                    onClick={() => handleTogglePreview(f)}
                  >Show image</button>
                  {canDelete && (
                    <button
                      className="discussions-message-file__btn discussions-message-file__btn--delete"
                      title="Delete file"
                      onClick={() => handleDelete(f.file_id)}
                    >🗑</button>
                  )}
                </div>
              )
            ) : (
              <div className="discussions-message-file__chip">
                <svg className="discussions-message-file__chip-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
                <button
                  className="discussions-message-file__chip-name"
                  onClick={() => handleDownload(f.file_id, f.name)}
                  title={`Download ${f.name}`}
                >
                  {f.name}
                </button>
                <span className="discussions-message-file__chip-size">{formatFileSize(f.size_bytes)}</span>
                {canDelete && (
                  <button
                    className="discussions-message-file__btn discussions-message-file__btn--delete"
                    title="Delete file"
                    onClick={() => handleDelete(f.file_id)}
                  >🗑</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
