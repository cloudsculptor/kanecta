import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Stack, Box, CircularProgress, Alert,
} from '@mui/material';
import { useWorkspaceStore } from '../../../store/workspace';
import type { KanectaItem } from '../../../types/kanecta';

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
  parameters: Param[];
  returnType?: string;
  returnTypeId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  item: KanectaItem;
}

export function RunFunctionDialog({ open, onClose, item }: Props) {
  const { getApi } = useWorkspaceStore();
  const [fnData, setFnData] = useState<FunctionData | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setArgs({});
    setFnData(null);
    getApi().items.getObject(item.id)
      .then((data) => {
        if (!data) return;
        const fn = data as unknown as FunctionData;
        setFnData(fn);
        const initial: Record<string, string> = {};
        (fn.parameters ?? []).forEach((p) => {
          if (p.defaultValue !== undefined) initial[p.name] = p.defaultValue;
        });
        setArgs(initial);
      })
      .catch(() => setError('Failed to load function definition.'))
      .finally(() => setLoading(false));
  }, [open, item.id, getApi]);

  const params = fnData?.parameters ?? [];
  const returnLabel = fnData?.returnType ?? fnData?.returnTypeId ?? 'unknown';

  const requiredParams = params.filter((p) => !p.optional && p.defaultValue === undefined);
  const canRun = !loading && requiredParams.every((p) => args[p.name]?.trim());

  const handleRun = async () => {
    setRunning(true);
    try {
      // TODO: wire to execution engine with args
      await Promise.resolve();
      onClose();
    } catch {
      setError('Execution failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} onClick={(e) => e.stopPropagation()} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        Run function
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{item.value}</Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '12px !important' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={32} /></Box>
        ) : (
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}

            {fnData?.description && (
              <Typography variant="body2" color="text.secondary">{fnData.description}</Typography>
            )}

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

            {fnData && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Returns: <strong>{returnLabel}</strong>
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={running}>Cancel</Button>
        <Button
          variant="contained"
          color="success"
          disabled={running || !canRun}
          onClick={() => void handleRun()}
        >
          {running ? 'Running…' : 'Run'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
