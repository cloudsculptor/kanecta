import { test, expect } from '@playwright/test';
import { setupApp } from './helpers';

test.describe('View navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test.describe('TopBar navigation', () => {
    test('Home button is active by default', async ({ page }) => {
      const homeBtn = page.locator('.TopBar-item').filter({ hasText: 'Home' });
      await expect(homeBtn).toHaveClass(/TopBar-item--active/);
      await expect(homeBtn).toHaveAttribute('aria-current', 'page');
    });

    test('clicking Settings switches the active view', async ({ page }) => {
      // Use .TopBar-item scoping to avoid matching the HomeView Settings shortcut
      await page.locator('.TopBar-item').filter({ hasText: 'Settings' }).click();
      const settingsBtn = page.locator('.TopBar-item').filter({ hasText: 'Settings' });
      await expect(settingsBtn).toHaveClass(/TopBar-item--active/);
      await expect(settingsBtn).toHaveAttribute('aria-current', 'page');
    });

    test('clicking Home after Settings returns Home to active', async ({ page }) => {
      await page.locator('.TopBar-item').filter({ hasText: 'Settings' }).click();
      await page.locator('.TopBar-item').filter({ hasText: 'Home' }).click();
      const homeBtn = page.locator('.TopBar-item').filter({ hasText: 'Home' });
      await expect(homeBtn).toHaveClass(/TopBar-item--active/);
    });

    test('Settings is not active when Home is selected', async ({ page }) => {
      const settingsBtn = page.locator('.TopBar-item').filter({ hasText: 'Settings' });
      await expect(settingsBtn).not.toHaveClass(/TopBar-item--active/);
      await expect(settingsBtn).not.toHaveAttribute('aria-current', 'page');
    });
  });

  test.describe('LeftBar navigation', () => {
    const leftBarViews = [
      { label: 'Tree' },
      { label: 'Types' },
      { label: 'Table' },
      { label: 'Functions' },
      { label: 'Combinator' },
      { label: 'AI' },
      { label: 'Graph' },
      { label: 'Quality' },
      { label: 'Pipelines' },
      { label: 'Claude' },
      { label: 'PR' },
    ];

    for (const { label } of leftBarViews) {
      test(`clicking ${label} sets it as active in LeftBar`, async ({ page }) => {
        const btn = page.locator('.LeftBar-item').filter({ hasText: label });
        if (label === 'Tree') {
          // Tree button is visually covered by TopBar-topLeftCorner — use native DOM click
          await btn.evaluate((el) => (el as HTMLElement).click());
        } else {
          await btn.click();
        }
        await expect(btn).toHaveClass(/LeftBar-item--active/);
        await expect(btn).toHaveAttribute('aria-current', 'page');
      });
    }

    test('only one LeftBar item is active at a time', async ({ page }) => {
      // force:true because Tree button is covered by TopBar-topLeftCorner overlay
      await page.locator('.LeftBar-item').filter({ hasText: 'Tree' }).evaluate((el) => (el as HTMLElement).click());
      await page.locator('.LeftBar-item').filter({ hasText: 'Table' }).click();

      const activeItems = page.locator('.LeftBar-item--active');
      await expect(activeItems).toHaveCount(1);
    });
  });

  test.describe('BottomBar navigation', () => {
    const bottomBarViews = ['Starred', 'History', 'Layouts', 'Todo'];

    for (const label of bottomBarViews) {
      test(`clicking ${label} sets it as active in BottomBar`, async ({ page }) => {
        const btn = page.locator('.BottomBar-item').filter({ hasText: label });
        await btn.click();
        await expect(btn).toHaveClass(/BottomBar-item--active/);
        await expect(btn).toHaveAttribute('aria-current', 'page');
      });
    }

    test('only one BottomBar item is active at a time', async ({ page }) => {
      await page.locator('.BottomBar-item').filter({ hasText: 'Starred' }).click();
      await page.locator('.BottomBar-item').filter({ hasText: 'Todo' }).click();

      const activeItems = page.locator('.BottomBar-item--active');
      await expect(activeItems).toHaveCount(1);
    });
  });

  test.describe('Cross-bar consistency', () => {
    test('switching from LeftBar view to TopBar Home clears LeftBar active state', async ({ page }) => {
      await page.locator('.LeftBar-item').filter({ hasText: 'Tree' }).evaluate((el) => (el as HTMLElement).click());
      await expect(page.locator('.LeftBar-item--active')).toHaveCount(1);

      await page.locator('.TopBar-item').filter({ hasText: 'Home' }).click();

      await expect(page.locator('.LeftBar-item--active')).toHaveCount(0);
    });

    test('switching from TopBar Settings to LeftBar Tree clears Settings active state', async ({ page }) => {
      await page.locator('.TopBar-item').filter({ hasText: 'Settings' }).click();
      const settingsBtn = page.locator('.TopBar-item').filter({ hasText: 'Settings' });
      await expect(settingsBtn).toHaveClass(/TopBar-item--active/);

      await page.locator('.LeftBar-item').filter({ hasText: 'Tree' }).evaluate((el) => (el as HTMLElement).click());
      await expect(settingsBtn).not.toHaveClass(/TopBar-item--active/);
    });
  });

  test.describe('View content rendering', () => {
    test('Settings view renders a theme selector', async ({ page }) => {
      await page.locator('.TopBar-item').filter({ hasText: 'Settings' }).click();
      await expect(page.locator('.SettingsPage')).toBeVisible();
      await expect(page.locator('.SettingsPage-select')).toBeVisible();
    });

    test('navigating to Tree view activates the LeftBar item', async ({ page }) => {
      await page.locator('.LeftBar-item').filter({ hasText: 'Tree' }).evaluate((el) => (el as HTMLElement).click());
      await expect(page.locator('.LeftBar-item--active')).toHaveCount(1);
    });
  });
});
