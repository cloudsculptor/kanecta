import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import SyncIcon from '@mui/icons-material/Sync';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Alert from '@mui/material/Alert';
import { useWorkspaceStore } from '../../../store/workspace';
import type { SystemItem } from '../../../api/systemItems';
import type { TypeDefinition } from '../../../api/types';
import './SyncTypesDialog.scss';

function useCopyId() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = useCallback((id: string) => {
    void navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(s => s === id ? null : s), 1500);
  }, []);
  return { copiedId, copy };
}

interface SyncTypesDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SyncTypesDialog({ open, onClose }: SyncTypesDialogProps) {
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();
  const [importChecked, setImportChecked] = useState<Set<string>>(new Set());
  const [exportChecked, setExportChecked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { copiedId, copy } = useCopyId();

  const { data: systemItems = [], isLoading: loadingCommon } = useQuery({
    queryKey: ['sync-system-items'],
    queryFn: () => getApi().systemItems.list(),
    enabled: open,
  });

  const { data: instanceTypes = [], isLoading: loadingInstance } = useQuery({
    queryKey: ['types'],
    queryFn: () => getApi().types.list(),
    enabled: open,
  });

  const instanceIds = new Set(instanceTypes.map((t: TypeDefinition) => t.id));
  const commonFolderIds = new Set(systemItems.map((c: SystemItem) => c.folderId));

  const notInInstance = systemItems.filter((c: SystemItem) => !instanceIds.has(c.folderId));
  const notInCommon = instanceTypes.filter((t: TypeDefinition) => !commonFolderIds.has(t.id));
  const inSyncCount = systemItems.filter((c: SystemItem) => instanceIds.has(c.folderId)).length;

  // Import column checkbox logic
  const allImportIds = notInInstance.map(c => c.folderId);
  const allImportChecked = allImportIds.length > 0 && allImportIds.every(id => importChecked.has(id));
  const someImportChecked = allImportIds.some(id => importChecked.has(id));

  const toggleImportAll = () => {
    setImportChecked(allImportChecked ? new Set() : new Set(allImportIds));
  };
  const toggleImport = (id: string) => {
    setImportChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // Export column checkbox logic
  const allExportIds = notInCommon.map(t => t.id);
  const allExportChecked = allExportIds.length > 0 && allExportIds.every(id => exportChecked.has(id));
  const someExportChecked = allExportIds.some(id => exportChecked.has(id));

  const toggleExportAll = () => {
    setExportChecked(allExportChecked ? new Set() : new Set(allExportIds));
  };
  const toggleExport = (id: string) => {
    setExportChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleImport = async () => {
    const ids = [...importChecked];
    if (ids.length === 0) return;
    setImporting(true);
    try {
      await getApi().systemItems.importItems(ids);
      await qc.invalidateQueries({ queryKey: ['types'] });
      setImportChecked(new Set());
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    const ids = [...exportChecked];
    if (ids.length === 0) return;
    setExporting(true);
    try {
      await getApi().systemItems.exportItems(ids);
      setExportChecked(new Set());
    } finally {
      setExporting(false);
    }
  };

  const loading = loadingCommon || loadingInstance;

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false}
      PaperProps={{ sx: { maxHeight: '80vh', width: '80vw', maxWidth: '1400px' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SyncIcon fontSize="small" />
        Sync Types
      </DialogTitle>
      <DialogContent dividers sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Alert severity="warning">
          Exporting items writes them to the shared <code>kanecta-system-items</code> directory on disk. You are responsible for pushing any exported items to GitHub so they are available to other contributors.
        </Alert>
        <div style={{ overflow: 'hidden', display: 'flex', flex: 1 }}>
        {loading ? (
          <div className="SyncTypesDialog-loading"><CircularProgress size={24} /></div>
        ) : (
          <div className="SyncTypesDialog-columns">

            <section className="SyncTypesDialog-section">
              <h3 className="SyncTypesDialog-section-title">
                In common, not in instance
                <span className="SyncTypesDialog-count">{notInInstance.length}</span>
              </h3>
              {notInInstance.length === 0 ? (
                <p className={inSyncCount > 0 ? 'SyncTypesDialog-synced' : 'SyncTypesDialog-empty'}>
                  {inSyncCount > 0
                    ? `All ${inSyncCount} common type${inSyncCount !== 1 ? 's' : ''} are already in this instance.`
                    : systemItems.length === 0 ? 'No system items directory found.' : 'Nothing to import.'
                  }
                </p>
              ) : (
                <>
                  <div className="SyncTypesDialog-list-header">
                    <label className="SyncTypesDialog-toggle-all">
                      <input
                        type="checkbox"
                        checked={allImportChecked}
                        ref={el => { if (el) el.indeterminate = someImportChecked && !allImportChecked; }}
                        onChange={toggleImportAll}
                      />
                      <span>Select all</span>
                    </label>
                  </div>
                  <ul className="SyncTypesDialog-list">
                    {notInInstance.map((c) => (
                      <li key={c.folderId} className="SyncTypesDialog-item">
                        <label className="SyncTypesDialog-item-label">
                          <input
                            type="checkbox"
                            checked={importChecked.has(c.folderId)}
                            onChange={() => toggleImport(c.folderId)}
                          />
                          <span className="SyncTypesDialog-name">{c.title}</span>
                        </label>
                        <button
                          className={`SyncTypesDialog-copy${copiedId === c.folderId ? ' SyncTypesDialog-copy--done' : ''}`}
                          title={c.folderId}
                          onClick={() => copy(c.folderId)}
                        >
                          <ContentCopyIcon className="SyncTypesDialog-copy-icon" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="SyncTypesDialog-bulk">
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!someImportChecked || importing}
                      onClick={() => void handleImport()}
                      startIcon={importing ? <CircularProgress size={14} color="inherit" /> : undefined}
                    >
                      Import selected{importChecked.size > 0 ? ` (${importChecked.size})` : ''}
                    </Button>
                  </div>
                </>
              )}
            </section>

            <section className="SyncTypesDialog-section">
              <h3 className="SyncTypesDialog-section-title">
                In instance, not in common
                <span className="SyncTypesDialog-count">{notInCommon.length}</span>
              </h3>
              {notInCommon.length === 0 ? (
                <p className={instanceTypes.length > 0 ? 'SyncTypesDialog-synced' : 'SyncTypesDialog-empty'}>
                  {instanceTypes.length > 0
                    ? `All ${instanceTypes.length} instance type${instanceTypes.length !== 1 ? 's' : ''} are already in the common directory.`
                    : 'No instance types found.'
                  }
                </p>
              ) : (
                <>
                  <div className="SyncTypesDialog-list-header">
                    <label className="SyncTypesDialog-toggle-all">
                      <input
                        type="checkbox"
                        checked={allExportChecked}
                        ref={el => { if (el) el.indeterminate = someExportChecked && !allExportChecked; }}
                        onChange={toggleExportAll}
                      />
                      <span>Select all</span>
                    </label>
                  </div>
                  <ul className="SyncTypesDialog-list">
                    {notInCommon.map((t) => (
                      <li key={t.id} className="SyncTypesDialog-item">
                        <label className="SyncTypesDialog-item-label">
                          <input
                            type="checkbox"
                            checked={exportChecked.has(t.id)}
                            onChange={() => toggleExport(t.id)}
                          />
                          <span className="SyncTypesDialog-name">{t.value}</span>
                        </label>
                        <button
                          className={`SyncTypesDialog-copy${copiedId === t.id ? ' SyncTypesDialog-copy--done' : ''}`}
                          title={t.id}
                          onClick={() => copy(t.id)}
                        >
                          <ContentCopyIcon className="SyncTypesDialog-copy-icon" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="SyncTypesDialog-bulk">
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!someExportChecked || exporting}
                      onClick={() => void handleExport()}
                      startIcon={exporting ? <CircularProgress size={14} color="inherit" /> : undefined}
                    >
                      Export selected{exportChecked.size > 0 ? ` (${exportChecked.size})` : ''}
                    </Button>
                  </div>
                </>
              )}
            </section>

          </div>
        )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
