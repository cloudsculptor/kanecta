import { test, expect } from '@playwright/test';
import { setupApp, MOCK_SETTINGS, MOCK_CONFIG } from './helpers';

const MOCK_TREE_WITH_ITEMS = [
  { item: { id: 'aaa-111', value: 'Alpha item', type: 'note', confidence: null, sortOrder: 0, tags: [], createdAt: '2024-01-01T00:00:00Z', modifiedAt: '2024-01-01T00:00:00Z' }, depth: 0 },
  { item: { id: 'bbb-222', value: 'Beta note', type: 'note', confidence: null, sortOrder: 1, tags: [], createdAt: '2024-01-01T00:00:00Z', modifiedAt: '2024-01-01T00:00:00Z' }, depth: 0 },
];

test.describe('CommandPalette', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('is not visible on initial load', async ({ page }) => {
    await expect(page.getByRole('dialog', { name: 'Command palette' })).not.toBeVisible();
  });

  test.describe('opening', () => {
    test('opens when the Search button in TopBar is clicked', async ({ page }) => {
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    });

    test('opens on Ctrl+K keyboard shortcut', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    });

    test('focuses the search input automatically when opened', async ({ page }) => {
      await page.getByRole('button', { name: 'Search' }).click();
      await page.waitForTimeout(50);
      const input = page.getByRole('textbox', { name: 'Search' });
      await expect(input).toBeFocused();
    });

    test('search input is empty when opened', async ({ page }) => {
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByRole('textbox', { name: 'Search' })).toHaveValue('');
    });
  });

  test.describe('closing', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    });

    test('closes on Escape key', async ({ page }) => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Command palette' })).not.toBeVisible();
    });

    test('closes when the backdrop is clicked', async ({ page }) => {
      await page.locator('.CommandPalette-backdrop').click();
      await expect(page.getByRole('dialog', { name: 'Command palette' })).not.toBeVisible();
    });
  });

  test.describe('empty state', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: 'Search' }).click();
    });

    test('shows "Start typing to search" when query is empty', async ({ page }) => {
      await expect(page.locator('.CommandPalette-empty')).toHaveText('Start typing to search…');
    });

    test('shows no result message when query matches nothing', async ({ page }) => {
      await page.getByRole('textbox', { name: 'Search' }).fill('xyzzy-no-match');
      await expect(page.locator('.CommandPalette-empty')).toContainText('No results for');
      await expect(page.locator('.CommandPalette-empty')).toContainText('xyzzy-no-match');
    });
  });

  test.describe('re-open state', () => {
    test('query is cleared when re-opened', async ({ page }) => {
      await page.getByRole('button', { name: 'Search' }).click();
      await page.getByRole('textbox', { name: 'Search' }).fill('some query');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByRole('textbox', { name: 'Search' })).toHaveValue('');
    });
  });
});

/**
 * These tests need pre-populated tree data. They use their own setup (single navigation)
 * to avoid the double-navigation timeout that occurs when nesting inside the
 * parent CommandPalette describe (which also navigates via setupApp).
 */
test.describe('CommandPalette — search with items', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.route((url) => url.pathname.startsWith('/api/'), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route((url) => url.pathname === '/api/items', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route((url) => url.pathname === '/api/items/stats', (route) =>
      route.fulfill({ status: 200, json: { total: 0, typedCount: 0, unstructured: [], structured: [] } }));
    await page.route((url) => url.pathname === '/api/types', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route((url) => url.pathname === '/api/skills', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route((url) => url.pathname === '/api/app/studio/layouts', (route) =>
      route.fulfill({ status: 200, json: { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', label: 'Default', root: { type: 'leaf', id: 'leaf-1', viewType: null, itemId: null } }] } }));
    await page.route((url) => url.pathname === '/api/app/studio/settings', (route) =>
      route.fulfill({ status: 200, json: MOCK_SETTINGS }));
    await page.route((url) => url.pathname === '/api/config', (route) =>
      route.fulfill({ status: 200, json: MOCK_CONFIG }));
    // 2-item tree mock — registered last so it takes priority (LIFO)
    await page.route((url) => url.pathname === '/api/tree', (route) =>
      route.fulfill({ status: 200, json: MOCK_TREE_WITH_ITEMS }));

    await page.goto('/');
    await page.waitForSelector('.AppShell', { timeout: 15_000 });
    await page.waitForTimeout(500);
  });

  test('filters items by query and shows matches', async ({ page }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Search' }).fill('Alpha');

    await expect(page.locator('.CommandPalette-group-label')).toHaveText('Items');
    await expect(page.locator('.CommandPalette-item')).toHaveCount(1);
    await expect(page.locator('.CommandPalette-item-label')).toHaveText('Alpha item');
  });

  test('shows multiple matches when query is broad', async ({ page }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    // Both mock items contain "a": "Alpha item" and "Beta note"
    await page.getByRole('textbox', { name: 'Search' }).fill('a');

    await expect(page.locator('.CommandPalette-item')).toHaveCount(2);
  });

  test('shows no results when query does not match any item', async ({ page }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Search' }).fill('zzz-nothing');

    await expect(page.locator('.CommandPalette-empty')).toContainText('No results for');
  });
});

test.describe('CommandPalette — keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.route((url) => url.pathname.startsWith('/api/'), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route((url) => url.pathname === '/api/items', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route((url) => url.pathname === '/api/items/stats', (route) =>
      route.fulfill({ status: 200, json: { total: 0, typedCount: 0, unstructured: [], structured: [] } }));
    await page.route((url) => url.pathname === '/api/types', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route((url) => url.pathname === '/api/skills', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route((url) => url.pathname === '/api/app/studio/layouts', (route) =>
      route.fulfill({ status: 200, json: { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', label: 'Default', root: { type: 'leaf', id: 'leaf-1', viewType: null, itemId: null } }] } }));
    await page.route((url) => url.pathname === '/api/app/studio/settings', (route) =>
      route.fulfill({ status: 200, json: MOCK_SETTINGS }));
    await page.route((url) => url.pathname === '/api/config', (route) =>
      route.fulfill({ status: 200, json: MOCK_CONFIG }));
    await page.route((url) => url.pathname === '/api/tree', (route) =>
      route.fulfill({ status: 200, json: MOCK_TREE_WITH_ITEMS }));

    await page.goto('/');
    await page.waitForSelector('.AppShell', { timeout: 15_000 });
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Search' }).click();
    // "a" matches both "Alpha item" and "Beta note"
    await page.getByRole('textbox', { name: 'Search' }).fill('a');
    // Wait for results to appear
    await page.waitForSelector('.CommandPalette-item');
  });

  test('first result is focused by default', async ({ page }) => {
    const firstItem = page.locator('.CommandPalette-item').first();
    await expect(firstItem).toHaveClass(/CommandPalette-item--focused/);
    await expect(firstItem).toHaveAttribute('aria-selected', 'true');
  });

  test('ArrowDown moves focus to next result', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    const items = page.locator('.CommandPalette-item');
    await expect(items.nth(1)).toHaveClass(/CommandPalette-item--focused/);
  });

  test('ArrowUp moves focus back to previous result', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    const firstItem = page.locator('.CommandPalette-item').first();
    await expect(firstItem).toHaveClass(/CommandPalette-item--focused/);
  });
});
