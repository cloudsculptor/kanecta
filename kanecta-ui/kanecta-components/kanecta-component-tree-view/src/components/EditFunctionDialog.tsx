import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Switch, FormControlLabel, Stack,
  Typography, Divider, IconButton, Box, CircularProgress,
  Radio, RadioGroup, FormControl, FormLabel, Alert, Tooltip, Checkbox,
  Tabs, Tab,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CodeIcon from '@mui/icons-material/Code';
import { functionSpec } from '@kanecta/specification';
import { useTreeViewContext } from '../context';
import { BodyConflictDialog } from './BodyConflictDialog';
import type { KanectaItem } from '../types';

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
  includeKanectaSdk: boolean;
  dependencies: string[];
}

const EMPTY: FormState = {
  async: false,
  ai: false,
  typeParameters: [],
  parameters: [],
  returnMode: 'primitive',
  returnType: 'void',
  throws: [],
  includeKanectaSdk: true,
  dependencies: [],
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
    includeKanectaSdk: (raw.includeKanectaSdk as boolean) ?? true,
    dependencies: ((raw.dependencies as string[]) ?? []),
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
  if (!form.includeKanectaSdk) out.includeKanectaSdk = false;
  if (form.dependencies.length > 0) out.dependencies = form.dependencies;
  return out;
}

// ─── Helper components ────────────────────────────────────────────────────────

function TypeHelperText({ fullText }: { fullText: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span>TypeScript primitive type (string, number, boolean…)</span>
      <Tooltip title={fullText} placement="right" arrow>
        <InfoOutlinedIcon sx={{ fontSize: '0.9rem', color: 'text.secondary', cursor: 'help', flexShrink: 0 }} />
      </Tooltip>
    </span>
  );
}

// ─── Live code preview ────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .replace(/([A-Z])/g, (_, c: string) => `-${c.toLowerCase()}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'function';
}

function buildPackageJsonPreview(itemName: string, form: FormState): string {
  const usesSdk = form.includeKanectaSdk;
  const dependencies: Record<string, string> = {};
  if (usesSdk) dependencies['@kanecta/sdk'] = '*';
  for (const dep of form.dependencies) {
    const atIdx = dep.lastIndexOf('@');
    if (atIdx > 0) {
      dependencies[dep.slice(0, atIdx)] = dep.slice(atIdx + 1);
    } else {
      dependencies[dep] = '*';
    }
  }
  const pkg: Record<string, unknown> = {
    name: `kanecta-fn-${slugify(itemName)}`,
    version: '1.0.0',
    private: true,
    scripts: { build: 'tsc', start: 'ts-node index.ts' },
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    devDependencies: {
      'typescript': '^5.0.0',
      'ts-node': '^10.9.0',
      '@types/node': '^20.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2);
}

function fnNameFrom(itemName: string): string {
  return (
    itemName
      .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/^[A-Z]/, (c: string) => c.toLowerCase())
      .replace(/[^a-zA-Z0-9_$]/g, '_') || 'fn'
  );
}

function buildCodePreview(fnName: string, form: FormState): string {
  const lines: string[] = [];

  lines.push('// AUTO-GENERATED — do not edit the function signature.');
  lines.push('// This file is regenerated from function.json on each save.');
  lines.push('// Only edit the body of the function below.');
  lines.push('');

  if (form.includeKanectaSdk || form.dependencies.length > 0) {
    lines.push('// Dependencies:');
    if (form.includeKanectaSdk) lines.push('//   @kanecta/sdk');
    for (const dep of form.dependencies) lines.push(`//   ${dep}`);
    lines.push('');
  }

  if (form.includeKanectaSdk) {
    lines.push("import { createClient } from '@kanecta/sdk';");
    lines.push('');
    lines.push('const kanecta = createClient();');
    lines.push('');
  }

  const jsdocLines: string[] = [];
  if (form.description) jsdocLines.push(` * ${form.description}`);
  for (const p of form.parameters) {
    if (p.description) jsdocLines.push(` * @param ${p.name} - ${p.description}`);
  }
  for (const t of form.throws) {
    jsdocLines.push(` * @throws {${t.type}}${t.description ? ` - ${t.description}` : ''}`);
  }
  if (form.deprecated) jsdocLines.push(` * @deprecated ${form.deprecated}`);
  if (jsdocLines.length > 0) {
    lines.push('/**');
    lines.push(...jsdocLines);
    lines.push(' */');
  }

  const typeParams = form.typeParameters.map((tp) => {
    let s = tp.name || 'T';
    if (tp.constraint) s += ` extends ${tp.constraint}`;
    if (tp.default) s += ` = ${tp.default}`;
    return s;
  });
  const typeParamsStr = typeParams.length ? `<${typeParams.join(', ')}>` : '';

  const paramStrs = form.parameters.map((p) => {
    const tsType = p.typeMode === 'kanecta'
      ? `KType_${(p.typeId ?? '').slice(0, 8) || 'unknown'}`
      : (p.type ?? 'unknown');
    const name = p.name || 'param';
    const prefix = p.rest ? '...' : '';
    if (p.defaultValue) {
      const dv = tsType === 'string' && !/^["'`]/.test(p.defaultValue)
        ? `"${p.defaultValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : p.defaultValue;
      return `  ${prefix}${name}: ${tsType} = ${dv}`;
    }
    if (p.optional) return `  ${prefix}${name}?: ${tsType}`;
    return `  ${prefix}${name}: ${tsType}`;
  });

  const returnType = form.returnMode === 'kanecta'
    ? `KType_${(form.returnTypeId ?? '').slice(0, 8) || 'unknown'}`
    : (form.returnType?.trim() || 'void');

  const asyncKw = form.async ? 'async ' : '';

  if (paramStrs.length > 0) {
    lines.push(`export ${asyncKw}function ${fnName}${typeParamsStr}(`);
    lines.push(paramStrs.join(',\n'));
    lines.push(`): ${returnType} {`);
  } else {
    lines.push(`export ${asyncKw}function ${fnName}${typeParamsStr}(): ${returnType} {`);
  }

  if (form.body?.trim()) {
    for (const l of form.body.split('\n')) lines.push(`  ${l}`);
  } else {
    lines.push('  // TODO: implement');
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  item: KanectaItem;
  onOpenRun?: () => void;
}

export function EditFunctionDialog({ open, onClose, item, onOpenRun }: Props) {
  const { api, vscodeAvailable } = useTreeViewContext();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compileResult, setCompileResult] = useState<{ success: boolean; output: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [scaffoldExists, setScaffoldExists] = useState(false);
  const [showDirtyWarning, setShowDirtyWarning] = useState(false);
  const [showBodyConflict, setShowBodyConflict] = useState(false);
  const [diskBody, setDiskBody] = useState('');
  const [externallyModified, setExternallyModified] = useState(false);
  const loadedBodyRef = useRef<string | undefined>(undefined);
  const datastorePathRef = useRef<string | undefined>(undefined);

  const [rightTab, setRightTab] = useState<'code' | 'packageJson'>('code');

  const fnName = useMemo(() => fnNameFrom(item.value ?? 'fn'), [item.value]);
  const codePreview = useMemo(() => buildCodePreview(fnName, form), [fnName, form]);
  const packageJsonPreview = useMemo(
    () => buildPackageJsonPreview(item.value ?? 'fn', form),
    [item.value, form],
  );

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setIsDirty(false);
    setCompileResult(null);
    setExternallyModified(false);
    Promise.all([
      api.items.getFunctionData(item.id).catch(() => null),
      api.items.checkFunctionScaffold(item.id).catch(() => ({ exists: false, stale: false })),
    ]).then(([data, scaffold]) => {
      const loaded = data ? fromRaw(data) : EMPTY;
      setForm(loaded);
      loadedBodyRef.current = loaded.body;
      setScaffoldExists(scaffold.exists);
    }).finally(() => setLoading(false));
  }, [open, item.id, api]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(async () => {
      try {
        const diskData = await api.items.getFunctionData(item.id).catch(() => null);
        const currentDiskBody = (diskData?.body as string | undefined) ?? '';
        const loadedBody = loadedBodyRef.current ?? '';
        setExternallyModified(currentDiskBody !== loadedBody);
      } catch {
        // ignore poll errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [open, item.id, api]);

  const openInVscode = useCallback(async () => {
    if (!datastorePathRef.current) {
      const cfg = await api.config.get();
      datastorePathRef.current = cfg.datastorePath as string;
    }
    const stripped = item.id.replace(/-/g, '');
    const path = `${datastorePathRef.current}/.kanecta/data/${stripped.slice(0, 2)}/${stripped.slice(2, 4)}/${item.id}/function/index.ts`;
    void api.config.openInVscode(path);
  }, [item.id, api]);

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
      await api.items.saveFunctionData(item.id, toRaw(form));
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCompile = async () => {
    setSaving(true);
    setError(null);
    setCompileResult(null);
    try {
      await api.items.saveFunctionData(item.id, toRaw(form));
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
      return;
    }
    setSaving(false);
    setCompiling(true);
    try {
      const result = await api.items.compileFunctionScaffold(item.id);
      setCompileResult(result);
    } catch {
      setCompileResult({ success: false, output: 'Compile request failed. Check the server.' });
    } finally {
      setCompiling(false);
    }
  };

  const handleSave = async () => {
    if (isDirty && scaffoldExists) {
      setShowDirtyWarning(true);
      return;
    }
    await checkBodyConflictThenSave();
  };

  const checkBodyConflictThenSave = async () => {
    try {
      const diskData = await api.items.getFunctionData(item.id).catch(() => null);
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

  const busy = saving || compiling;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onClick={(e) => e.stopPropagation()}
      maxWidth="lg"
      fullWidth
      sx={{ '& .MuiDialog-paper': { height: '90vh', width: '90vw', maxWidth: '90vw' } }}
    >
      <DialogTitle sx={{ pb: 0, pr: 6 }}>
        Edit function
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{item.value}</Typography>
        <IconButton
          onClick={onClose}
          disabled={busy}
          sx={{ position: 'absolute', top: 8, right: 8 }}
          size="small"
        >
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
        {/* ── Left column: form ── */}
        <Box sx={{ overflow: 'auto', pr: 0.5 }}>
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
                            helperText={<TypeHelperText fullText={paramProps.type.description} />} />
                        ) : (
                          <TextField size="small" label="Type UUID" required value={p.typeId ?? ''}
                            onChange={(e) => updateParam(i, { typeId: e.target.value })}
                            placeholder="UUID" sx={{ flex: 1 }}
                            helperText={paramProps.typeId.description} />
                        )}
                        <IconButton size="small" aria-label="Remove parameter" onClick={() => removeParam(i)} sx={{ mt: 0.5 }}>
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
                    helperText={<TypeHelperText fullText={specProps.returnType.description} />} />
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

              <Divider />

              {/* Dependencies */}
              <Stack spacing={1.5}>
                <Typography variant="overline" color="text.secondary">Dependencies</Typography>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={form.includeKanectaSdk}
                      onChange={(e) => set('includeKanectaSdk', e.target.checked)}
                      size="small"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" component="span">@kanecta/sdk</Typography>
                      <Typography component="span" variant="caption" color="text.secondary"> — Kanecta API client (always included by default)</Typography>
                    </Box>
                  }
                />
                <TextField
                  label="Additional packages"
                  multiline
                  minRows={2}
                  fullWidth
                  value={form.dependencies.join('\n')}
                  onChange={(e) => {
                    setIsDirty(true);
                    setForm((f) => ({
                      ...f,
                      dependencies: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                    }));
                  }}
                  placeholder={'axios@^1.0.0\nlodash'}
                  helperText="One package per line. Use name@version or just name for latest."
                  slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: '0.8125rem' } } }}
                />
              </Stack>

              {/* Body */}
              {externallyModified && vscodeAvailable && (
                <Alert
                  severity="warning"
                  action={
                    <Button
                      size="small"
                      startIcon={<CodeIcon fontSize="small" />}
                      onClick={() => void openInVscode()}
                    >
                      Open in VS Code
                    </Button>
                  }
                >
                  This file was modified outside the editor. Saving will overwrite those changes.
                </Alert>
              )}
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
        </Box>

        {/* ── Right column: tabbed preview + build log ── */}
        <Box sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <Tabs
            value={rightTab}
            onChange={(_, v: 'code' | 'packageJson') => setRightTab(v)}
            sx={{ flexShrink: 0, minHeight: 32, mb: 1, '& .MuiTab-root': { minHeight: 32, py: 0.5 } }}
          >
            <Tab label="Generated code" value="code" />
            <Tab label="Package.json" value="packageJson" />
          </Tabs>

          {rightTab === 'code' && (
            <>
              <Box
                component="pre"
                sx={{
                  flex: compileResult ? '0 1 auto' : 1,
                  minHeight: 120,
                  overflow: 'auto',
                  m: 0,
                  p: 1.5,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  lineHeight: 1.5,
                  bgcolor: '#1e1e1e',
                  color: '#d4d4d4',
                  borderRadius: 1,
                  whiteSpace: 'pre',
                }}
              >
                {codePreview}
              </Box>

              {compileResult && (
                <>
                  <Divider flexItem sx={{ flexShrink: 0, my: 1 }} />
                  <Typography
                    variant="overline"
                    sx={{ lineHeight: 1, flexShrink: 0, color: compileResult.success ? 'success.main' : 'error.main' }}
                  >
                    {compileResult.success ? 'Build succeeded' : 'Build failed'}
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      flex: 1,
                      minHeight: 80,
                      overflow: 'auto',
                      m: 0,
                      p: 1.5,
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      lineHeight: 1.5,
                      bgcolor: '#1e1e1e',
                      color: compileResult.success ? '#4ec9b0' : '#f48771',
                      borderRadius: 1,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {compileResult.output || 'No output.'}
                  </Box>
                </>
              )}
            </>
          )}

          {rightTab === 'packageJson' && (
            <Box
              component="pre"
              sx={{
                flex: 1,
                overflow: 'auto',
                m: 0,
                p: 1.5,
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                lineHeight: 1.5,
                bgcolor: '#1e1e1e',
                color: '#d4d4d4',
                borderRadius: 1,
                whiteSpace: 'pre',
              }}
            >
              {packageJsonPreview}
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        {onOpenRun && (
          <Button
            variant="outlined"
            color="success"
            disabled={busy}
            onClick={onOpenRun}
            sx={{ mr: 'auto' }}
          >
            Run function
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>Close</Button>
        <Button variant="outlined" disabled={busy || loading || !isValid} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="contained" disabled={busy || loading} onClick={() => void handleCompile()}>
          {compiling ? 'Compiling…' : saving ? 'Saving…' : 'Save & Compile'}
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
