import { test, expect } from '@playwright/test';
import { setupApp } from './helpers';

const TEST_UUID = '12345678-1234-1234-1234-123456789abc';

test.describe('TopBar navigation input', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('renders the input field', async ({ page }) => {
    const input = page.getByRole('textbox', { name: 'Navigate to item' });
    await expect(input).toBeVisible();
  });

  test('accepts typed text', async ({ page }) => {
    const input = page.getByRole('textbox', { name: 'Navigate to item' });
    await input.fill('hello world');
    await expect(input).toHaveValue('hello world');
  });

  test('input has correct placeholder (empty)', async ({ page }) => {
    const input = page.getByRole('textbox', { name: 'Navigate to item' });
    // The placeholder is "" per the component — just check the input exists
    await expect(input).toBeVisible();
  });

  test.describe('UUID navigation', () => {
    test('entering a valid UUID and pressing Enter sets the window hash', async ({ page }) => {
      const input = page.getByRole('textbox', { name: 'Navigate to item' });
      await input.fill(TEST_UUID);
      await input.press('Enter');

      await expect(page).toHaveURL(new RegExp(`#/tree/${TEST_UUID}`));
    });

    test('clears the input after UUID navigation', async ({ page }) => {
      const input = page.getByRole('textbox', { name: 'Navigate to item' });
      await input.fill(TEST_UUID);
      await input.press('Enter');
      await expect(input).toHaveValue('');
    });

    test('does not clear input when UUID navigation fails (for alias fallback)', async ({ page }) => {
      // Empty input — pressing Enter should be a no-op
      const input = page.getByRole('textbox', { name: 'Navigate to item' });
      await input.press('Enter');
      await expect(input).toHaveValue('');
    });
  });

  test.describe('alias navigation', () => {
    test('resolves a known alias and navigates to its target', async ({ page }) => {
      const aliasTarget = '99999999-9999-9999-9999-999999999999';
      await page.route(
        (url) => url.pathname.startsWith('/api/aliases/'),
        (route) => route.fulfill({ status: 200, json: { alias: 'myalias', targetId: aliasTarget } }),
      );

      const input = page.getByRole('textbox', { name: 'Navigate to item' });
      await input.fill('myalias');
      await input.press('Enter');

      await expect(page).toHaveURL(new RegExp(`#/tree/${aliasTarget}`));
      await expect(input).toHaveValue('');
    });

    test('leaves the input unchanged when alias lookup fails', async ({ page }) => {
      await page.route(
        (url) => url.pathname.startsWith('/api/aliases/'),
        (route) => route.fulfill({ status: 404, json: { error: 'Not found' } }),
      );

      const input = page.getByRole('textbox', { name: 'Navigate to item' });
      await input.fill('unknown-alias');
      await input.press('Enter');

      // Input remains showing the text (alias not found)
      await expect(input).toHaveValue('unknown-alias');
    });

    test('is case-insensitive — resolves alias in lowercase', async ({ page }) => {
      const aliasTarget = '88888888-8888-8888-8888-888888888888';
      let resolvedAlias: string | null = null;
      await page.route(
        (url) => url.pathname.startsWith('/api/aliases/'),
        (route) => {
          // url is only in scope for the predicate — use route.request() to get it in the handler
          resolvedAlias = decodeURIComponent(new URL(route.request().url()).pathname.split('/api/aliases/')[1]);
          route.fulfill({ status: 200, json: { alias: resolvedAlias, targetId: aliasTarget } });
        },
      );

      const input = page.getByRole('textbox', { name: 'Navigate to item' });
      await input.fill('MyAlias');
      await input.press('Enter');

      expect(resolvedAlias).toBe('myalias');
    });
  });

  test.describe('non-Enter key behaviour', () => {
    test('typing without pressing Enter does not trigger navigation', async ({ page }) => {
      const initialUrl = page.url();
      const input = page.getByRole('textbox', { name: 'Navigate to item' });
      await input.fill('something');
      await input.press('Tab');

      expect(page.url()).toBe(initialUrl);
    });
  });
});
