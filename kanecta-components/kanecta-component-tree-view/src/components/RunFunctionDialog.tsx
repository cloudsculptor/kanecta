import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Stack, Box, CircularProgress, Alert,
  Divider, IconButton, Tabs, Tab,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTreeViewContext } from '../context';
import type { KanectaItem } from '../types';

interface Param {
  name: string;
  type?: string;
  typeId?: string;
  optional?: boolean;
  rest?: boolean;
  defaultValue?: string;
  description?: string;
}

interface FunctionData {
  description?: string;
  ai?: boolean;
  parameters: Param[];
  returnType?: string;
  returnTypeId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  item: KanectaItem;
  onOpenEdit?: () => void;
}

export function RunFunctionDialog({ open, onClose, item, onOpenEdit }: Props) {
  const { api } = useTreeViewContext();
  const [fnData, setFnData] = useState<FunctionData | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [runSuccess, setRunSuccess] = useState<boolean | null>(null);
  const [showStaleDialog, setShowStaleDialog] = useState(false);
  const [rightTab, setRightTab] = useState<'logs' | 'packageJson'>('logs');
  const [packageJson, setPackageJson] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setArgs({});
    setFnData(null);
    setOutput(null);
    setLogs(null);
    setPackageJson(null);
    Promise.all([
      api.items.getFunctionData(item.id),
      api.items.checkFunctionScaffold(item.id).catch(() => ({ exists: false, stale: false })),
      api.items.getFunctionPackageJson(item.id).catch(() => null),
    ])
      .then(([data, scaffold, pkg]) => {
        if (!data) return;
        const fn = data as unknown as FunctionData;
        setFnData(fn);
        const initial: Record<string, string> = {};
        (fn.parameters ?? []).forEach((p) => {
          if (p.defaultValue !== undefined) initial[p.name] = p.defaultValue;
        });
        setArgs(initial);
        if (scaffold.stale) setShowStaleDialog(true);
        if (pkg) setPackageJson(JSON.stringify(pkg, null, 2));
      })
      .catch(() => setError('Failed to load function definition.'))
      .finally(() => setLoading(false));
  }, [open, item.id, api]);

  const params = fnData?.parameters ?? [];
  const returnLabel = fnData?.returnType ?? fnData?.returnTypeId ?? 'unknown';

  const requiredParams = params.filter((p) => !p.optional && p.defaultValue === undefined);
  const canRun = !loading && requiredParams.every((p) => args[p.name]?.trim());

  const handleRun = async () => {
    setRunning(true);
    setOutput(null);
    setLogs(null);
    setError(null);
    setRunSuccess(null);
    try {
      const result = await api.items.runFunctionScaffold(item.id, args);
      setOutput(result.output);
      setLogs(result.logs);
      setRunSuccess(result.success);
      if (!result.success && !result.logs) setError('Execution failed with no output.');
    } catch {
      setError('Failed to reach the server.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onClick={(e) => e.stopPropagation()}
      maxWidth="lg"
      fullWidth
      sx={{ '& .MuiDialog-paper': { width: '90vw', maxWidth: '90vw', height: '80vh' } }}
    >
      <DialogTitle sx={{ pb: 0, pr: 6 }}>
        Run function
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{item.value}</Typography>
        <IconButton onClick={onClose} disabled={running} sx={{ position: 'absolute', top: 8, right: 8 }} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 3,
          overflow: 'hidden',
          pt: '12px !important',
        }}
      >
        {loading ? (
          <Box sx={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : (
          <>
            {/* ── Left: inputs + output ── */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto' }}>
              {error && <Alert severity="error">{error}</Alert>}

              {fnData?.ai && (
                <Alert
                  severity="warning"
                  icon={<AutoAwesomeIcon />}
                  sx={{ fontWeight: 700, fontSize: '0.95rem', alignItems: 'center' }}
                >
                  <strong>This function calls AI.</strong> Running it will consume AI tokens.
                </Alert>
              )}

              {fnData?.description && (
                <Typography variant="body2" color="text.secondary">{fnData.description}</Typography>
              )}

              <Stack spacing={2}>
                {params.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    This function takes no arguments.
                  </Typography>
                ) : (
                  params.map((p) => {
                    const typeLabel = p.type ?? (p.typeId ? `Kanecta: ${p.typeId}` : 'unknown');
                    const helperParts: string[] = [`type: ${typeLabel}`];
                    if (p.description) helperParts.unshift(p.description);
                    return (
                      <TextField
                        key={p.name}
                        label={
                          <Box component="span">
                            {p.name}
                            {p.optional && (
                              <Typography component="span" variant="caption" color="text.secondary"> optional</Typography>
                            )}
                            {p.rest && (
                              <Typography component="span" variant="caption" color="text.secondary"> ...rest</Typography>
                            )}
                          </Box>
                        }
                        value={args[p.name] ?? ''}
                        onChange={(e) => setArgs((a) => ({ ...a, [p.name]: e.target.value }))}
                        fullWidth
                        required={!p.optional}
                        placeholder={p.defaultValue !== undefined ? `default: ${p.defaultValue}` : undefined}
                        helperText={helperParts.join(' — ')}
                      />
                    );
                  })
                )}
              </Stack>

              {fnData && (
                <Typography variant="caption" color="text.secondary">
                  Returns: <strong>{returnLabel}</strong>
                </Typography>
              )}

              {output !== null && (
                <>
                  <Divider />
                  <Typography variant="overline" color="text.secondary">Output</Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0, p: 1.5,
                      fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.5,
                      bgcolor: '#1e1e1e', color: '#d4d4d4',
                      borderRadius: 1, whiteSpace: 'pre-wrap', overflow: 'auto',
                      flex: 1, minHeight: 80,
                    }}
                  >
                    {output}
                  </Box>
                </>
              )}
            </Box>

            {/* ── Right: tabbed panel ── */}
            <Box sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Tabs
                value={rightTab}
                onChange={(_, v: 'logs' | 'packageJson') => setRightTab(v)}
                sx={{ flexShrink: 0, minHeight: 32, mb: 1, '& .MuiTab-root': { minHeight: 32, py: 0.5 } }}
              >
                <Tab
                  label={
                    runSuccess === null ? 'Logs'
                    : runSuccess ? 'Logs — success'
                    : 'Logs — failed'
                  }
                  value="logs"
                  sx={{
                    color: rightTab === 'logs'
                      ? (runSuccess === null ? undefined : runSuccess ? 'success.main' : 'error.main')
                      : undefined,
                  }}
                />
                <Tab label="Package.json" value="packageJson" />
              </Tabs>

              {rightTab === 'logs' && (
                <Box
                  component="pre"
                  sx={{
                    flex: 1,
                    m: 0, p: 1.5,
                    fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.5,
                    bgcolor: '#1e1e1e',
                    color: runSuccess === false ? '#f48771' : '#d4d4d4',
                    borderRadius: 1, whiteSpace: 'pre-wrap', overflow: 'auto',
                  }}
                >
                  {logs ?? ''}
                </Box>
              )}

              {rightTab === 'packageJson' && (
                <Box
                  component="pre"
                  sx={{
                    flex: 1,
                    m: 0, p: 1.5,
                    fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.5,
                    bgcolor: '#1e1e1e', color: '#d4d4d4',
                    borderRadius: 1, whiteSpace: 'pre-wrap', overflow: 'auto',
                  }}
                >
                  {packageJson ?? '(no package.json — save the function first)'}
                </Box>
              )}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions>
        {onOpenEdit && (
          <Button
            variant="outlined"
            disabled={running}
            onClick={onOpenEdit}
            sx={{ mr: 'auto' }}
          >
            Edit function
          </Button>
        )}
        <Button onClick={onClose} disabled={running}>Close</Button>
        <Button
          variant="contained"
          color="success"
          disabled={running || !canRun}
          onClick={() => void handleRun()}
        >
          {running ? 'Running…' : 'Run'}
        </Button>
      </DialogActions>

      {/* Stale warning dialog */}
      <Dialog
        open={showStaleDialog}
        onClose={() => setShowStaleDialog(false)}
        onClick={(e) => e.stopPropagation()}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Function modified since last compiled</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            The generated code has changed since this function was last compiled.
            It will be rebuilt automatically when you run it.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowStaleDialog(false)}>Close</Button>
          <Button variant="contained" onClick={() => setShowStaleDialog(false)}>
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
