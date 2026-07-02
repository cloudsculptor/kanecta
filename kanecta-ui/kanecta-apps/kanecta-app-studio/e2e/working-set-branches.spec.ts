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

/** Same as withWorkingSets, but the active branch is a working branch with a diff. */
async function withBranchedWorkingSet(page: Page): Promise<{ mergeCalls: number }> {
  const state = { mergeCalls: 0 };
  await setupApp(page);

  await page.route(
    (url) => url.pathname === '/api/working-sets',
    (route) => route.fulfill({ status: 200, json: BRANCHED_WORKING_SETS }),
  );
  await page.route(
    (url) => /\/api\/working-sets\/[^/]+\/branches\/[^/]+\/diff$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, json: { branch: 'feature/edits', adds: 3, edits: 2, deletes: 1 } }),
  );
  await page.route(
    (url) => /\/api\/working-sets\/[^/]+\/branches\/[^/]+\/merge$/.test(url.pathname),
    (route) => {
      state.mergeCalls += 1;
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
    await page.getByRole('button', { name: 'Merge into main' }).click();

    await expect.poll(() => state.mergeCalls).toBeGreaterThan(0);
  });
});
