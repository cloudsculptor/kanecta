import { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Switch, FormControlLabel, Stack,
  Typography, Divider, IconButton, Box, CircularProgress,
  Radio, RadioGroup, FormControl, FormLabel, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { functionSpec } from '@kanecta/specification';
import { useWorkspaceStore } from '../../../store/workspace';
import { BodyConflictDialog } from './BodyConflictDialog';
import type { KanectaItem } from '../../../types/kanecta';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const specProps = (functionSpec as any).properties;
const paramProps = specProps.parameters.items.properties;

interface TypeParam {
  name: string;
  constraint?: string;
  default?: string;
}

interface Param {
  name: string;
  typeMode: 'primitive' | 'kanecta';
  type?: string;
  typeId?: string;
  optional?: boolean;
  rest?: boolean;
  defaultValue?: string;
  description?: string;
}

interface ThrowEntry {
  type: string;
  description?: string;
}

interface FormState {
  description?: string;
  async: boolean;
  ai: boolean;
  skill?: string;
  typeParameters: TypeParam[];
  parameters: Param[];
  returnMode: 'primitive' | 'kanecta';
  returnType?: string;
  returnTypeId?: string;
  throws: ThrowEntry[];
  deprecated?: string;
  body?: string;
}

const EMPTY: FormState = {
  async: false,
  ai: false,
  typeParameters: [],
  parameters: [],
  returnMode: 'primitive',
  returnType: 'void',
  throws: [],
};

function fromRaw(raw: Record<string, unknown>): FormState {
  return {
    description: raw.description as string | undefined,
    async: (raw.async as boolean) ?? false,
    ai: (raw.ai as boolean) ?? false,
    skill: raw.skill as string | undefined,
    typeParameters: ((raw.typeParameters as TypeParam[]) ?? []),
    parameters: ((raw.parameters as Param[]) ?? []).map((p) => ({
      ...p,
      typeMode: p.typeId ? 'kanecta' : 'primitive',
    })),
    returnMode: raw.returnTypeId ? 'kanecta' : 'primitive',
    returnType: raw.returnType as string | undefined,
    returnTypeId: raw.returnTypeId as string | undefined,
    throws: ((raw.throws as ThrowEntry[]) ?? []),
    deprecated: raw.deprecated as string | undefined,
    body: raw.body as string | undefined,
  };
}

function toRaw(form: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    parameters: form.parameters.map(({ typeMode: _t, ...p }) => p),
  };
  if (form.description?.trim()) out.description = form.description.trim();
  if (form.async) out.async = true;
  if (form.ai) out.ai = true;
  if (form.skill?.trim()) out.skill = form.skill.trim();
  if (form.typeParameters.length) out.typeParameters = form.typeParameters;
  if (form.returnMode === 'primitive') {
    out.returnType = form.returnType?.trim() ?? 'void';
  } else {
    out.returnTypeId = form.returnTypeId?.trim();
  }
  if (form.throws.length) out.throws = form.throws;
  if (form.deprecated?.trim()) out.deprecated = form.deprecated.trim();
  if (form.body?.trim()) out.body = form.body.trim();
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  item: KanectaItem;
}

export function EditFunctionDialog({ open, onClose, item }: Props) {
  const { getApi } = useWorkspaceStore();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [scaffoldExists, setScaffoldExists] = useState(false);
  const [showDirtyWarning, setShowDirtyWarning] = useState(false);
  const [showBodyConflict, setShowBodyConflict] = useState(false);
  const [diskBody, setDiskBody] = useState('');
  const loadedBodyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setIsDirty(false);
    Promise.all([
      getApi().items.getFunctionData(item.id).catch(() => null),
      getApi().items.checkFunctionScaffold(item.id).catch(() => ({ exists: false })),
    ]).then(([data, scaffold]) => {
      const loaded = data ? fromRaw(data) : EMPTY;
      setForm(loaded);
      loadedBodyRef.current = loaded.body;
      setScaffoldExists(scaffold.exists);
    }).finally(() => setLoading(false));
  }, [open, item.id, getApi]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setIsDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const dirtySet = (updater: (f: FormState) => FormState) => {
    setIsDirty(true);
    setForm(updater);
  };

  // --- type parameters ---
  const addTypeParam = () => dirtySet((f) => ({ ...f, typeParameters: [...f.typeParameters, { name: '' }] }));
  const updateTypeParam = (i: number, patch: Partial<TypeParam>) =>
    dirtySet((f) => ({ ...f, typeParameters: f.typeParameters.map((p, idx) => idx === i ? { ...p, ...patch } : p) }));
  const removeTypeParam = (i: number) =>
    dirtySet((f) => ({ ...f, typeParameters: f.typeParameters.filter((_, idx) => idx !== i) }));

  // --- parameters ---
  const addParam = () =>
    dirtySet((f) => ({ ...f, parameters: [...f.parameters, { name: '', typeMode: 'primitive', type: 'string' }] }));
  const updateParam = (i: number, patch: Partial<Param>) =>
    dirtySet((f) => ({ ...f, parameters: f.parameters.map((p, idx) => idx === i ? { ...p, ...patch } : p) }));
  const removeParam = (i: number) =>
    dirtySet((f) => ({ ...f, parameters: f.parameters.filter((_, idx) => idx !== i) }));

  // --- throws ---
  const addThrow = () => dirtySet((f) => ({ ...f, throws: [...f.throws, { type: '' }] }));
  const updateThrow = (i: number, patch: Partial<ThrowEntry>) =>
    dirtySet((f) => ({ ...f, throws: f.throws.map((t, idx) => idx === i ? { ...t, ...patch } : t) }));
  const removeThrow = (i: number) =>
    dirtySet((f) => ({ ...f, throws: f.throws.filter((_, idx) => idx !== i) }));

  const isValid =
    (form.returnMode === 'primitive' ? !!form.returnType?.trim() : !!form.returnTypeId?.trim()) &&
    form.parameters.every((p) =>
      p.name.trim() && (p.typeMode === 'primitive' ? !!p.type?.trim() : !!p.typeId?.trim())
    );

  const doSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await getApi().items.saveFunctionData(item.id, toRaw(form));
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    // Stage 1 — dirty warning: scaffold exists and form has changes
    if (isDirty && scaffoldExists) {
      setShowDirtyWarning(true);
      return;
    }
    await checkBodyConflictThenSave();
  };

  const checkBodyConflictThenSave = async () => {
    // Stage 2 — body conflict: fetch current disk body and compare
    try {
      const diskData = await getApi().items.getFunctionData(item.id).catch(() => null);
      const currentDiskBody = (diskData?.body as string | undefined) ?? '';
      const formBody = form.body ?? '';
      if (currentDiskBody !== formBody && (currentDiskBody || formBody)) {
        setDiskBody(currentDiskBody);
        setShowBodyConflict(true);
        return;
      }
    } catch {
      // if we can't fetch, proceed with save
    }
    await doSave();
  };

  const handleDirtyWarningConfirm = async () => {
    setShowDirtyWarning(false);
    await checkBodyConflictThenSave();
  };

  const handleUseFormBody = async () => {
    setShowBodyConflict(false);
    await doSave();
  };

  const handleUseDiskBody = () => {
    setShowBodyConflict(false);
    setForm((f) => ({ ...f, body: diskBody || undefined }));
    // Don't auto-save — let the user review the restored body first
  };

  return (
    <Dialog open={open} onClose={onClose} onClick={(e) => e.stopPropagation()} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        Edit function
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{item.value}</Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '12px !important' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={32} /></Box>
        ) : (
          <Stack spacing={3}>
            {error && <Alert severity="error">{error}</Alert>}

            {/* Basic */}
            <Stack spacing={2}>
              <TextField
                label="Description"
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
                fullWidth multiline minRows={2}
                helperText={specProps.description.description}
              />
              <Stack direction="row" spacing={3}>
                <FormControlLabel
                  control={<Switch checked={form.async} onChange={(e) => set('async', e.target.checked)} />}
                  label="Async"
                />
                <FormControlLabel
                  control={<Switch checked={form.ai} onChange={(e) => set('ai', e.target.checked)} color="secondary" />}
                  label={
                    <Box>
                      AI
                      <Typography component="span" variant="caption" color="text.secondary"> — invokes AI internally</Typography>
                    </Box>
                  }
                />
              </Stack>
            </Stack>

            <Divider />

            {/* Skill */}
            <Stack spacing={1}>
              <Typography variant="overline" color="text.secondary">Skill</Typography>
              <TextField
                label="Skill UUID"
                value={form.skill ?? ''}
                onChange={(e) => set('skill', e.target.value || undefined)}
                fullWidth
                placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                helperText={specProps.skill.description}
              />
            </Stack>

            <Divider />

            {/* Type parameters */}
            <Stack spacing={1}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="overline" color="text.secondary">Type Parameters</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={addTypeParam}>Add</Button>
              </Stack>
              {form.typeParameters.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>None</Typography>
              )}
              {form.typeParameters.map((tp, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <TextField size="small" label="Name" required value={tp.name}
                    onChange={(e) => updateTypeParam(i, { name: e.target.value })}
                    placeholder="T" sx={{ width: 100 }} />
                  <TextField size="small" label="Constraint" value={tp.constraint ?? ''}
                    onChange={(e) => updateTypeParam(i, { constraint: e.target.value || undefined })}
                    placeholder="extends string" sx={{ flex: 1 }} />
                  <TextField size="small" label="Default" value={tp.default ?? ''}
                    onChange={(e) => updateTypeParam(i, { default: e.target.value || undefined })}
                    placeholder="unknown" sx={{ flex: 1 }} />
                  <IconButton size="small" onClick={() => removeTypeParam(i)} sx={{ mt: 0.5 }}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>

            <Divider />

            {/* Parameters */}
            <Stack spacing={1.5}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="overline" color="text.secondary">Parameters</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={addParam}>Add parameter</Button>
              </Stack>
              {form.parameters.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>No parameters</Typography>
              )}
              {form.parameters.map((p, i) => (
                <Box key={i} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <TextField size="small" label="Name" required value={p.name}
                        onChange={(e) => updateParam(i, { name: e.target.value })}
                        sx={{ width: 140 }} />
                      <FormControl size="small">
                        <FormLabel sx={{ fontSize: '0.75rem', mb: 0.5 }}>Type</FormLabel>
                        <RadioGroup row value={p.typeMode}
                          onChange={(e) => { setIsDirty(true); updateParam(i, {
                            typeMode: e.target.value as Param['typeMode'],
                            type: undefined,
                            typeId: undefined,
                          }); }}>
                          <FormControlLabel value="primitive" control={<Radio size="small" />} label={<Typography variant="body2">Primitive</Typography>} />
                          <FormControlLabel value="kanecta" control={<Radio size="small" />} label={<Typography variant="body2">Kanecta type</Typography>} />
                        </RadioGroup>
                      </FormControl>
                      {p.typeMode === 'primitive' ? (
                        <TextField size="small" label="Type" required value={p.type ?? ''}
                          onChange={(e) => updateParam(i, { type: e.target.value })}
                          placeholder="string" sx={{ flex: 1 }}
                          helperText={paramProps.type.description} />
                      ) : (
                        <TextField size="small" label="Type UUID" required value={p.typeId ?? ''}
                          onChange={(e) => updateParam(i, { typeId: e.target.value })}
                          placeholder="UUID" sx={{ flex: 1 }}
                          helperText={paramProps.typeId.description} />
                      )}
                      <IconButton size="small" onClick={() => removeParam(i)} sx={{ mt: 0.5 }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <FormControlLabel
                        control={<Switch size="small" checked={p.optional ?? false} onChange={(e) => updateParam(i, { optional: e.target.checked })} />}
                        label={<Typography variant="caption">Optional</Typography>}
                      />
                      <FormControlLabel
                        control={<Switch size="small" checked={p.rest ?? false} onChange={(e) => updateParam(i, { rest: e.target.checked })} />}
                        label={<Typography variant="caption">Rest (...)</Typography>}
                      />
                      <TextField size="small" label="Default value" value={p.defaultValue ?? ''}
                        onChange={(e) => updateParam(i, { defaultValue: e.target.value || undefined })}
                        placeholder='e.g. 0 or "hello"' sx={{ flex: 1, minWidth: 140 }} />
                      <TextField size="small" label="Description" value={p.description ?? ''}
                        onChange={(e) => updateParam(i, { description: e.target.value || undefined })}
                        sx={{ flex: 2, minWidth: 180 }} />
                    </Stack>
                  </Stack>
                </Box>
              ))}
            </Stack>

            <Divider />

            {/* Return type */}
            <Stack spacing={1.5}>
              <Typography variant="overline" color="text.secondary">Return Type</Typography>
              <FormControl>
                <RadioGroup row value={form.returnMode}
                  onChange={(e) => { setIsDirty(true); setForm((f) => ({
                    ...f,
                    returnMode: e.target.value as FormState['returnMode'],
                    returnType: undefined,
                    returnTypeId: undefined,
                  })); }}>
                  <FormControlLabel value="primitive" control={<Radio size="small" />} label={<Typography variant="body2">Primitive</Typography>} />
                  <FormControlLabel value="kanecta" control={<Radio size="small" />} label={<Typography variant="body2">Kanecta type</Typography>} />
                </RadioGroup>
              </FormControl>
              {form.returnMode === 'primitive' ? (
                <TextField size="small" label="Return type" required
                  value={form.returnType ?? ''}
                  onChange={(e) => set('returnType', e.target.value)}
                  placeholder="void" sx={{ maxWidth: 320 }}
                  helperText={specProps.returnType.description} />
              ) : (
                <TextField size="small" label="Return type UUID" required
                  value={form.returnTypeId ?? ''}
                  onChange={(e) => set('returnTypeId', e.target.value)}
                  placeholder="UUID" sx={{ maxWidth: 320 }}
                  helperText={specProps.returnTypeId.description} />
              )}
            </Stack>

            <Divider />

            {/* Throws */}
            <Stack spacing={1}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="overline" color="text.secondary">Throws</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={addThrow}>Add</Button>
              </Stack>
              {form.throws.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>None</Typography>
              )}
              {form.throws.map((t, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <TextField size="small" label="Error type" required value={t.type}
                    onChange={(e) => updateThrow(i, { type: e.target.value })}
                    placeholder="Error" sx={{ width: 200 }} />
                  <TextField size="small" label="When thrown" value={t.description ?? ''}
                    onChange={(e) => updateThrow(i, { description: e.target.value || undefined })}
                    sx={{ flex: 1 }} />
                  <IconButton size="small" onClick={() => removeThrow(i)} sx={{ mt: 0.5 }}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>

            <Divider />

            {/* Deprecated */}
            <TextField
              label="Deprecated"
              value={form.deprecated ?? ''}
              onChange={(e) => set('deprecated', e.target.value || undefined)}
              fullWidth
              placeholder="Leave blank if not deprecated"
              helperText={specProps.deprecated.description}
            />

            {/* Body */}
            <TextField
              label="Body"
              value={form.body ?? ''}
              onChange={(e) => set('body', e.target.value || undefined)}
              fullWidth multiline minRows={5}
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: '0.8125rem' } } }}
              helperText={specProps.body.description}
            />
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" disabled={saving || loading || !isValid} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>

      {/* Stage 1 — dirty warning */}
      <Dialog open={showDirtyWarning} onClose={() => setShowDirtyWarning(false)} onClick={(e) => e.stopPropagation()} maxWidth="xs" fullWidth>
        <DialogTitle>Overwrite generated code?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            The <code>function/</code> directory already exists. Saving will regenerate <code>index.ts</code> and overwrite any manual edits you made in your IDE.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDirtyWarning(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={() => void handleDirtyWarningConfirm()}>
            Save anyway
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stage 2 — body conflict */}
      <BodyConflictDialog
        open={showBodyConflict}
        onClose={() => setShowBodyConflict(false)}
        diskBody={diskBody}
        formBody={form.body ?? ''}
        onUseForm={() => void handleUseFormBody()}
        onUseDisk={handleUseDiskBody}
      />
    </Dialog>
  );
}
