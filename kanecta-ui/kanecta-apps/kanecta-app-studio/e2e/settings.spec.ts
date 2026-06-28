import { test, expect } from '@playwright/test';
import { setupApp } from './helpers';

const THEMES = ['White', 'Light', 'Dark', 'Solarised', 'Blue', 'Green'];

test.describe('Settings view', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    // Scope to .TopBar-item to avoid matching the HomeView Settings shortcut button
    await page.locator('.TopBar-item').filter({ hasText: 'Settings' }).click();
    await expect(page.locator('.SettingsPage')).toBeVisible();
  });

  test('renders the Settings page body', async ({ page }) => {
    await expect(page.locator('.SettingsPage-body')).toBeVisible();
  });

  test('shows the Theme section heading', async ({ page }) => {
    await expect(page.locator('.SettingsPage-section-title')).toHaveText('Theme');
  });

  test('renders the theme selector dropdown', async ({ page }) => {
    await expect(page.locator('.SettingsPage-select')).toBeVisible();
  });

  test.describe('theme options', () => {
    for (const themeName of THEMES) {
      test(`has "${themeName}" as an option`, async ({ page }) => {
        const select = page.locator('.SettingsPage-select');
        const option = select.locator(`option[value="${themeName}"]`);
        await expect(option).toHaveCount(1);
      });
    }

    test('shows all 6 theme options', async ({ page }) => {
      const options = page.locator('.SettingsPage-select option');
      await expect(options).toHaveCount(THEMES.length);
    });
  });

  test.describe('theme switching', () => {
    test('changing the theme calls POST /api/app/studio/settings', async ({ page }) => {
      let savedSettings: unknown;
      await page.route(
        (url) => url.pathname === '/api/app/studio/settings',
        async (route) => {
          if (route.request().method() === 'POST') {
            savedSettings = route.request().postDataJSON();
            await route.fulfill({ status: 200, json: { ok: true } });
          } else {
            await route.fulfill({ status: 200, json: {} });
          }
        },
      );

      await page.locator('.SettingsPage-select').selectOption('Dark');

      await expect.poll(() => savedSettings).toMatchObject({ themeName: 'Dark' });
    });

    test('switching to Light theme sends correct sidebar colour', async ({ page }) => {
      let savedSettings: Record<string, unknown> | undefined;
      await page.route(
        (url) => url.pathname === '/api/app/studio/settings',
        async (route) => {
          if (route.request().method() === 'POST') {
            savedSettings = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({ status: 200, json: { ok: true } });
          } else {
            await route.fulfill({ status: 200, json: {} });
          }
        },
      );

      await page.locator('.SettingsPage-select').selectOption('Light');

      await expect.poll(() => savedSettings).toMatchObject({ themeName: 'Light' });
      // Light theme has a specific sidebarBg different from White
      expect(savedSettings?.sidebarBg).toBeTruthy();
    });

    test('switching theme updates the data-theme attribute on body', async ({ page }) => {
      await page.locator('.SettingsPage-select').selectOption('Dark');
      // The useEffect in AppShell applies data-theme = themeName.toLowerCase()
      await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
    });

    test('switching to Blue theme sets data-theme to "blue"', async ({ page }) => {
      await page.route(
        (url) => url.pathname === '/api/app/studio/settings',
        async (route) => {
          if (route.request().method() === 'POST') {
            await route.fulfill({ status: 200, json: { ok: true } });
          } else {
            await route.fulfill({ status: 200, json: {} });
          }
        },
      );

      await page.locator('.SettingsPage-select').selectOption('Blue');
      await expect(page.locator('body')).toHaveAttribute('data-theme', 'blue');
    });
  });
});
