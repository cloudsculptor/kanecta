import { test, expect } from '@playwright/test';
import { setupApp, MOCK_ITEM } from './helpers';

/**
 * Regression e2e for the tree "add node" create call (PR #170).
 *
 * The API requires an explicit parentId on create; the add-node row used to
 * omit it, so adding a primitive returned HTTP 400 "parentId is required".
 * This drives the real flow — focus an item in the tree, click the add-node
 * row — and asserts the POST /api/items body carries the focused item's id
 * as parentId.
 */

test.describe('Tree view — add primitive under the focused item', () => {
  test('POST /api/items carries the focused item id as parentId', async ({ page }) => {
    await setupApp(page);

    // Endpoints the tree hits once it has rows to render. The baseline
    // catch-all answers {} — TreeNode's alias-count filter needs an array.
    await page.route(
      (url) => url.pathname === '/api/aliases',
      (route) => route.fulfill({ status: 200, json: [] }),
    );
    await page.route(
      (url) => url.pathname === '/api/starred',
      (route) => route.fulfill({ status: 200, json: [] }),
    );

    // Override the baseline /api/items mock (LIFO — this route wins): GET
    // returns one focusable item, POST captures the create body.
    let createBody: { value?: string; type?: string; parentId?: string } | null = null;
    await page.route(
      (url) => url.pathname === '/api/items',
      async (route) => {
        const req = route.request();
        if (req.method() === 'POST') {
          createBody = req.postDataJSON();
          return route.fulfill({
            status: 201,
            json: {
              ...MOCK_ITEM,
              id: '33333333-3333-3333-3333-333333333333',
              value: createBody?.value ?? '',
              parentId: createBody?.parentId ?? null,
            },
          });
        }
        return route.fulfill({ status: 200, json: [MOCK_ITEM] });
      },
    );

    // Open the Tree view (native DOM click — the button sits under the
    // TopBar-topLeftCorner overlay, same workaround as navigation.spec.ts).
    await page.locator('.LeftBar-item').filter({ hasText: 'Tree' }).evaluate((el) => (el as HTMLElement).click());

    // Focus the item by clicking its row (this also opens the inline editor —
    // abort it with Escape so the add-node click is clean).
    // Native DOM click: the click swaps the label for the inline editor, so
    // Playwright's stability wait sees the element detach and retries forever.
    const itemLabel = page.locator('.TreeNode-label').filter({ hasText: MOCK_ITEM.value });
    await itemLabel.evaluate((el) => (el as HTMLElement).click());
    await page.keyboard.press('Escape');

    // The add-node row is the trailing TreeNode-row in the content area.
    await page.locator('.TreeView-content .TreeNode-row').last().click();

    await expect.poll(() => createBody?.parentId).toBe(MOCK_ITEM.id);
    expect(createBody?.type).toBe('text');
  });
});
