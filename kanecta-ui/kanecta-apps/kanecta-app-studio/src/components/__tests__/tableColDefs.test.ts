import { describe, it, expect } from 'vitest';
import { buildColDefs } from '@kanecta/component-table';

// Column-merging rules for the table node preview (spec §tablePayload):
// overridden columns lead in declared order, un-overridden result columns
// follow in result order, hidden overrides drop out entirely.

const RESULT_COLS = [{ name: 'id' }, { name: 'value' }, { name: 'type' }];

describe('buildColDefs', () => {
  it('uses result-set order with field names as headers when no overrides', () => {
    const defs = buildColDefs(RESULT_COLS, []);
    expect(defs.map((d) => d.field)).toEqual(['id', 'value', 'type']);
    expect(defs.map((d) => d.headerName)).toEqual(['id', 'value', 'type']);
  });

  it('puts overridden columns first and applies label/width', () => {
    const defs = buildColDefs(RESULT_COLS, [
      { field: 'value', label: 'Item value', width: 240 },
    ]);
    expect(defs.map((d) => d.field)).toEqual(['value', 'id', 'type']);
    expect(defs[0].headerName).toBe('Item value');
    expect(defs[0].width).toBe(240);
  });

  it('drops hidden columns', () => {
    const defs = buildColDefs(RESULT_COLS, [{ field: 'id', hidden: true }]);
    expect(defs.map((d) => d.field)).toEqual(['value', 'type']);
  });

  it('ignores overrides for fields the result set does not contain', () => {
    const defs = buildColDefs(RESULT_COLS, [{ field: 'ghost', label: 'Ghost' }]);
    expect(defs.map((d) => d.field)).toEqual(['id', 'value', 'type']);
  });

  it('applies the default sort to the matching column only', () => {
    const defs = buildColDefs(RESULT_COLS, [], 'value', 'desc');
    expect(defs.find((d) => d.field === 'value')?.sort).toBe('desc');
    expect(defs.find((d) => d.field === 'id')?.sort).toBeUndefined();
  });
});
