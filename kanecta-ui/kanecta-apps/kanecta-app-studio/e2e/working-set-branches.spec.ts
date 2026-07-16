import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupApp } from './helpers';

const WORKING_SETS = {
  workingSets: [
    {
      name: 'kanecta-internal',
      local: { path: '/data/kanecta-internal', ok: true },
      remotes: {},
      branch: 'main',
      branches: [
        { name: 'main', active: true, baseBranch: null },
        { name: 'experiment', active: false, baseBranch: 'main' },
      ],
      isActive: true,
    },
  ],
  activeWorkingSet: 'kanecta-internal',
};

/**
 * Register the working-set API routes at highest priority (after setupApp), then
 * reload so the selector's initial fetch resolves against them.
 */
async function withWorkingSets(page: Page): Promise<{ createBodies: unknown[] }> {
  const createBodies: unknown[] = [];
  await setupApp(page);

  await page.route(
    (url) => url.pathname === '/api/working-sets',
    (route) => route.fulfill({ status: 200, json: WORKING_SETS }),
  );
  await page.route(
    (url) => /\/api\/working-sets\/[^/]+\/branches$/.test(url.pathname),
    async (route) => {
      createBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, json: { ok: true, branch: { name: 'feature/x', fill: 'full' } } });
    },
  );
  await page.route(
    (url) => /\/api\/working-sets\/[^/]+\/branches\/[^/]+\/switch$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, json: { ok: true, branch: 'feature/x' } }),
  );

  await page.reload();
  await page.waitForSelector('.AppShell', { timeout: 15_000 });
  return { createBodies };
}

test.describe('Working-set branch UX', () => {
  test('opens the selector and shows the active working set + branches', async ({ page }) => {
    await withWorkingSets(page);
    await page.getByRole('button', { name: 'Switch working set' }).click();
    await expect(page.getByText('Active working set')).toBeVisible();
    await expect(page.getByText('Branches')).toBeVisible();
    await expect(page.getByRole('button', { name: /New branch/ })).toBeVisible();
  });

  test('creates a new full branch through the dialog', async ({ page }) => {
    const { createBodies } = await withWorkingSets(page);

    await page.getByRole('button', { name: 'Switch working set' }).click();
    await page.getByRole('button', { name: /New branch/ }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Branch name').fill('feature/x');
    await page.getByRole('button', { name: 'Create branch' }).click();

    await expect.poll(() => createBodies.length).toBeGreaterThan(0);
    expect(createBodies[0]).toMatchObject({ branchName: 'feature/x', fill: 'full' });
  });

  test('creates a sparse branch tracking an upstream', async ({ page }) => {
    const { createBodies } = await withWorkingSets(page);

    await page.getByRole('button', { name: 'Switch working set' }).click();
    await page.getByRole('button', { name: /New branch/ }).click();

    await page.getByLabel('Branch name').fill('feature/offline');
    await page.getByRole('radio', { name: /Sparse/ }).click();
    await expect(page.getByLabel('Upstream branch')).toBeVisible();
    await page.getByRole('button', { name: 'Create branch' }).click();

    await expect.poll(() => createBodies.length).toBeGreaterThan(0);
    expect(createBodies[0]).toMatchObject({
      branchName: 'feature/offline',
      fill: 'sparse',
      upstream: { branch: 'main' },
    });
  });
});

const BRANCHED_WORKING_SETS = {
  workingSets: [
    {
      name: 'kanecta-internal',
      local: { path: '/data/kanecta-internal', ok: true },
      remotes: {},
      branch: 'feature/edits',
      branches: [
        { name: 'main', active: false, baseBranch: null },
        { name: 'feature/edits', active: true, baseBranch: 'main' },
      ],
      isActive: true,
    },
  ],
  activeWorkingSet: 'kanecta-internal',
};

interface BranchedState {
  mergeCalls: number;
  mergeBodies: unknown[];
}

/** Same as withWorkingSets, but the active branch is a working branch with a diff. */
async function withBranchedWorkingSet(page: Page): Promise<BranchedState> {
  const state: BranchedState = { mergeCalls: 0, mergeBodies: [] };
  await setupApp(page);

  await page.route(
    (url) => url.pathname === '/api/working-sets',
    (route) => route.fulfill({ status: 200, json: BRANCHED_WORKING_SETS }),
  );
  await page.route(
    (url) => /\/api\/working-sets\/[^/]+\/branches\/[^/]+\/diff$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, json: { branch: 'feature/edits', adds: 3, edits: 2, deletes: 1 } }),
  );
  // The dialog previews conflicts / blast radius when it opens. Default: clean,
  // with an item-level detail payload (the reviewable "PR diff").
  // Individual tests can register a higher-priority route to return conflicts.
  await page.route(
    (url) => /\/api\/working-sets\/[^/]+\/branches\/[^/]+\/merge-preview$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          branch: 'feature/edits',
          adds: 3,
          edits: 2,
          deletes: 1,
          conflicts: [],
          blastRadius: [],
          detail: {
            adds: [
              {
                id: '11111111-aaaa-bbbb-cccc-dddddddddddd',
                after: { id: '11111111-aaaa-bbbb-cccc-dddddddddddd', value: 'Fundraising ideas', type: 'note' },
              },
            ],
            edits: [
              {
                id: '44444444-aaaa-bbbb-cccc-dddddddddddd',
                before: { id: '44444444-aaaa-bbbb-cccc-dddddddddddd', value: 'AGM agenda', type: 'note', status: 'draft' },
                after: { id: '44444444-aaaa-bbbb-cccc-dddddddddddd', value: 'AGM agenda 2026', type: 'note', status: 'ready' },
              },
            ],
            deletes: [
              {
                id: '66666666-aaaa-bbbb-cccc-dddddddddddd',
                before: { id: '66666666-aaaa-bbbb-cccc-dddddddddddd', value: 'Old flyer', type: 'note' },
              },
            ],
          },
        },
      }),
  );
  await page.route(
    (url) => /\/api\/working-sets\/[^/]+\/branches\/[^/]+\/merge$/.test(url.pathname),
    (route) => {
      state.mergeCalls += 1;
      state.mergeBodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, json: { ok: true, merged: 6 } });
    },
  );

  await page.reload();
  await page.waitForSelector('.AppShell', { timeout: 15_000 });
  return state;
}

test.describe('Working-set pull requests', () => {
  test('shows live diff stats for the active working branch', async ({ page }) => {
    await withBranchedWorkingSet(page);

    await page.getByRole('button', { name: 'Switch working set' }).click();
    await expect(page.getByText('+3 add')).toBeVisible();
    await expect(page.getByText('±2 edit')).toBeVisible();
    await expect(page.getByText('−1 del')).toBeVisible();
  });

  test('merges the branch via the Create Pull Request dialog', async ({ page }) => {
    const state = await withBranchedWorkingSet(page);

    await page.getByRole('button', { name: 'Switch working set' }).click();
    await page.getByRole('button', { name: /Create Pull Request/ }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    const merge = page.getByRole('button', { name: 'Merge into main' });
    await expect(merge).toBeEnabled(); // clean preview → no strategy needed
    await merge.click();

    await expect.poll(() => state.mergeCalls).toBeGreaterThan(0);
  });

  test('renders the item-level changes for review, expandable to field diffs', async ({ page }) => {
    await withBranchedWorkingSet(page);

    await page.getByRole('button', { name: 'Switch working set' }).click();
    await page.getByRole('button', { name: /Create Pull Request/ }).click();

    // Every changed item is listed by label.
    const list = page.getByTestId('branch-diff-list');
    await expect(list).toBeVisible();
    const label = (text: string) => list.locator('.BranchDiffList__label', { hasText: text });
    await expect(label('Fundraising ideas')).toBeVisible();
    await expect(label('AGM agenda 2026')).toBeVisible();
    await expect(label('Old flyer')).toBeVisible();

    // Expanding the edit reveals the before → after field diff.
    await label('AGM agenda 2026').click();
    await expect(list.getByText('AGM agenda', { exact: true })).toBeVisible();
    await expect(list.getByText('draft')).toBeVisible();
    await expect(list.getByText('ready')).toBeVisible();
  });

  test('surfaces conflicts and requires a strategy before merging', async ({ page }) => {
    const state = await withBranchedWorkingSet(page);

    // Override the preview to report a conflict (main moved since the fork).
    await page.route(
      (url) => /\/api\/working-sets\/[^/]+\/branches\/[^/]+\/merge-preview$/.test(url.pathname),
      (route) =>
        route.fulfill({
          status: 200,
          json: {
            branch: 'feature/edits',
            adds: 3,
            edits: 2,
            deletes: 1,
            conflicts: [{ id: 'aaaaaaaa-1111-2222-3333-444444444444', kind: 'edit-edit' }],
            blastRadius: [],
          },
        }),
    );

    await page.getByRole('button', { name: 'Switch working set' }).click();
    await page.getByRole('button', { name: /Create Pull Request/ }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('merge-conflicts')).toBeVisible();

    // Merge is blocked until a strategy is chosen.
    const merge = page.getByRole('button', { name: 'Merge into main' });
    await expect(merge).toBeDisabled();
    await page.getByRole('radio', { name: /Keep this branch's version/ }).click();
    await expect(merge).toBeEnabled();

    await merge.click();
    await expect.poll(() => state.mergeCalls).toBeGreaterThan(0);
    expect(state.mergeBodies[0]).toMatchObject({ strategy: 'theirs' });
  });
});
