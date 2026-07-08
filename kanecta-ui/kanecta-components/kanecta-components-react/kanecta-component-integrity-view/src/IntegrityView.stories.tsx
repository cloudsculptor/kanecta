import type { Meta, StoryObj } from '@storybook/react';
import { IntegrityView, type IntegrityEvent, type IntegrityRunner } from './IntegrityView';

const wrap = (Story: React.ComponentType) => (
  <div style={{ width: 760, height: 560, position: 'relative', background: 'var(--color-bg, #fff)' }}>
    <Story />
  </div>
);

const meta: Meta<typeof IntegrityView> = {
  component: IntegrityView,
  title: 'Views/IntegrityView',
  decorators: [wrap],
};
export default meta;

type Story = StoryObj<typeof IntegrityView>;

const MANIFEST: IntegrityEvent = {
  type: 'manifest',
  total: 5,
  checks: [
    { id: 'id-is-uuid', title: 'Every item id is a valid UUID', group: 'structure', specRef: '' },
    { id: 'parentid-resolves', title: 'Every parentId resolves to an existing item', group: 'tree', specRef: '' },
    { id: 'object-payload-valid', title: 'Object payloads validate against their type jsonSchema', group: 'schema', specRef: '' },
    { id: 'alias-targets-resolve', title: 'Every alias points at an existing item', group: 'references', specRef: '' },
    { id: 'obj-table-matches-sqlschema', title: 'Postgres obj_<typeId> tables match the derived sqlSchema', group: 'storage', specRef: '' },
  ],
};

// Build a runner that emits the manifest, then each result on a timer, then done.
function mockRunner(results: IntegrityEvent[], summaryOverride?: Partial<IntegrityEvent & { summary: any }>): IntegrityRunner {
  return async ({ onEvent, signal }) => {
    onEvent(MANIFEST);
    for (let i = 0; i < results.length; i++) {
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, 350));
      if (signal.aborted) return;
      onEvent(results[i]);
    }
    const failed = results.filter((e) => e.type === 'result' && e.result.status === 'fail').length;
    const skipped = results.filter((e) => e.type === 'result' && e.result.status === 'skip').length;
    const errorCount = results.reduce((n, e) => n + (e.type === 'result' ? e.result.findings.filter((f) => f.severity === 'error').length : 0), 0);
    onEvent({
      type: 'done',
      summary: {
        total: results.length, passed: results.length - failed - skipped, failed, skipped,
        errorCount, warnCount: 0, ok: errorCount === 0,
      },
    });
  };
}

const okResults: IntegrityEvent[] = [
  { type: 'result', index: 0, result: { id: 'id-is-uuid', title: 'Every item id is a valid UUID', group: 'structure', specRef: '', status: 'pass', findings: [], count: 0 } },
  { type: 'result', index: 1, result: { id: 'parentid-resolves', title: 'Every parentId resolves to an existing item', group: 'tree', specRef: '', status: 'pass', findings: [], count: 0 } },
  { type: 'result', index: 2, result: { id: 'object-payload-valid', title: 'Object payloads validate against their type jsonSchema', group: 'schema', specRef: '', status: 'pass', findings: [], count: 0 } },
  { type: 'result', index: 3, result: { id: 'alias-targets-resolve', title: 'Every alias points at an existing item', group: 'references', specRef: '', status: 'pass', findings: [], count: 0 } },
  { type: 'result', index: 4, result: { id: 'obj-table-matches-sqlschema', title: 'Postgres obj_<typeId> tables match the derived sqlSchema', group: 'storage', specRef: '', status: 'skip', findings: [], count: 0, skipped: 'only applies to the Postgres (cloud) adapter' } },
];

const failingResults: IntegrityEvent[] = [
  okResults[0],
  { type: 'result', index: 1, result: { id: 'parentid-resolves', title: 'Every parentId resolves to an existing item', group: 'tree', specRef: '', status: 'fail', count: 1, findings: [{ severity: 'error', message: 'item 81bd… has parentId deadbeef-… which does not exist', fix: 're-parent the item or restore the missing parent' }] } },
  { type: 'result', index: 2, result: { id: 'object-payload-valid', title: 'Object payloads validate against their type jsonSchema', group: 'schema', specRef: '', status: 'fail', count: 1, findings: [{ severity: 'error', message: 'object 4f2c… payload.size: Expected number, got string' }] } },
  okResults[3],
  okResults[4],
];

export const AllPass: Story = {
  args: { run: mockRunner(okResults), autoRun: true },
};

export const WithFailures: Story = {
  args: { run: mockRunner(failingResults), autoRun: true },
};

export const Idle: Story = {
  args: { run: mockRunner(okResults), autoRun: false },
};
