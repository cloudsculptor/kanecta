import type { Page } from '@playwright/test';

export const MOCK_CONFIG = { vscodeAvailable: false };

export const MOCK_SETTINGS = {
  themeName: 'White',
  sidebarBg: 'var(--color-surface)',
  sidebarFg: 'var(--color-text-secondary)',
  sidebarFgSelected: 'var(--color-text)',
  contentBg: 'var(--color-surface)',
  contentBorder: 'var(--color-border)',
  showContentBorder: true,
  locationBorder: 'var(--color-border)',
};

export const MOCK_ITEM = {
  id: '11111111-1111-1111-1111-111111111111',
  value: 'Test item',
  type: 'note',
  confidence: 'medium',
  parentId: null,
  sortOrder: 0,
  tags: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

export const MOCK_TREE_ENTRY = { item: MOCK_ITEM, depth: 0 };

/**
 * Sets up all baseline API route mocks and navigates to the app.
 *
 * Routes are registered in order: catch-all first (lowest priority),
 * specific routes last (LIFO — highest priority).
 */
export async function setupApp(page: Page): Promise<void> {
  // Clear persisted store state so each test starts fresh
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Catch-all — lowest priority (registered first, runs last in LIFO)
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  // Specific routes — registered last, matched first
  await page.route(
    (url) => url.pathname === '/api/items',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === '/api/items/stats',
    (route) =>
      route.fulfill({
        status: 200,
        json: { total: 0, typedCount: 0, unstructured: [], structured: [] },
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/tree',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === '/api/types',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === '/api/skills',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === '/api/app/studio/layouts',
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', label: 'Default', root: { type: 'leaf', id: 'leaf-1', viewType: null, itemId: null } }],
        },
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/app/studio/settings',
    (route) => route.fulfill({ status: 200, json: MOCK_SETTINGS }),
  );
  await page.route(
    (url) => url.pathname === '/api/config',
    (route) => route.fulfill({ status: 200, json: MOCK_CONFIG }),
  );

  await page.goto('/');
  await page.waitForSelector('.AppShell', { timeout: 15_000 });
}

/** Convenience: wait for no pending React Query fetches. */
export async function waitForIdle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {
    // networkidle can be flaky with polling — ignore timeout and proceed
  });
}
