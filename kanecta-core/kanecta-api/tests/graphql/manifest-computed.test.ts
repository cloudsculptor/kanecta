// The community-hub computed-field backings are authored as `query` items. This
// proves they are well-formed and wire correctly: each type's computed `backedBy`
// resolves to a query file, the query builds a ComputedSpec, and its {{params}}
// bind to injection-safe parameterised SQL against a representative row + viewer.

import { describe, it, expect } from 'vitest';
import { buildSchemaModel } from '../../src/graphql/model.ts';
import { collectComputedBackings, computedSpecFromPayload, bindComputedSql } from '../../src/graphql/computed.ts';
import type { StoredRow, ExecContext } from '../../src/graphql/execute.ts';
import chThread from '../../manifests/community-hub/ch-thread.type.json' with { type: 'json' };
import chMessage from '../../manifests/community-hub/ch-message.type.json' with { type: 'json' };
import chFile from '../../manifests/community-hub/ch-file.type.json' with { type: 'json' };
import chThreadRead from '../../manifests/community-hub/ch-thread-read.type.json' with { type: 'json' };
import chThreadSub from '../../manifests/community-hub/ch-thread-subscription.type.json' with { type: 'json' };
import replyCount from '../../manifests/community-hub/ch-message-reply-count.query.json' with { type: 'json' };
import hasUnread from '../../manifests/community-hub/ch-thread-has-unread.query.json' with { type: 'json' };
import notifEnabled from '../../manifests/community-hub/ch-thread-notifications-enabled.query.json' with { type: 'json' };

const queriesById: Record<string, any> = {
  [replyCount.item.id]: replyCount,
  [hasUnread.item.id]: hasUnread,
  [notifEnabled.item.id]: notifEnabled,
};

const model = buildSchemaModel([chThread, chMessage, chFile, chThreadRead, chThreadSub]);

describe('community-hub computed-field query backings', () => {
  it('the two storage-only support types build without diagnostics; ch-thread stays exposed', () => {
    expect(model.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    // expose:false types are not query roots, but their presence must not error.
    expect(model.types.some((t) => t.name === 'ChThread')).toBe(true);
    expect(model.types.some((t) => t.name === 'ChThreadRead')).toBe(false);
  });

  it('every computed field in the model resolves to an authored query item', () => {
    const backings = collectComputedBackings(model);
    // ch-thread.hasUnread, ch-thread.isNotificationsEnabled, ch-message.replyCount
    expect(backings.length).toBe(3);
    for (const b of backings) expect(queriesById[b.backedBy]).toBeTruthy();
  });

  it('replyCount binds {{params.self}} to the row id as parameterised SQL', () => {
    const spec = computedSpecFromPayload(replyCount.payload, true);
    const row: StoredRow = { id: 'M1', columns: {} };
    const { sql, params } = bindComputedSql(spec.expression, row, {});
    expect(sql).not.toContain('{{');
    expect(sql).toContain('parent_id = $1');
    expect(params).toEqual(['M1']);
  });

  it('hasUnread + isNotificationsEnabled bind self→row and viewer→ctx (perViewer)', () => {
    const row: StoredRow = { id: 'T1', columns: {} };
    const ctx: ExecContext = { viewer: 'u-alice' };
    for (const q of [hasUnread, notifEnabled]) {
      const spec = computedSpecFromPayload(q.payload, true);
      const { sql, params } = bindComputedSql(spec.expression, row, ctx);
      expect(sql).not.toContain('{{');
      // both self (T1) and viewer (u-alice) are bound, order-independent
      expect(new Set(params)).toEqual(new Set(['T1', 'u-alice']));
      expect(params.length).toBe(2);
    }
  });
});
