import { test, expect } from '@playwright/test';
import { setupApp } from './helpers';

test.describe('AppShell structure', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('renders the root AppShell element', async ({ page }) => {
    await expect(page.locator('.AppShell')).toBeVisible();
  });

  test('renders the main content area', async ({ page }) => {
    await expect(page.locator('.Content')).toBeVisible();
  });

  test.describe('TopBar', () => {
    test('renders the TopBar nav', async ({ page }) => {
      await expect(page.locator('nav.TopBar')).toBeVisible();
    });

    test('has a Home button', async ({ page }) => {
      // Scope to .TopBar-item — HomeView also renders a Home button
      await expect(page.locator('.TopBar-item[aria-label="Home"]')).toBeVisible();
    });

    test('has a Search button', async ({ page }) => {
      await expect(page.locator('.TopBar-item[aria-label="Search"]')).toBeVisible();
    });

    test('has a Capture button', async ({ page }) => {
      await expect(page.locator('.TopBar-item[aria-label="Capture"]')).toBeVisible();
    });

    test('has a Settings button', async ({ page }) => {
      // Scope to .TopBar-item — HomeView also renders a Settings button
      await expect(page.locator('.TopBar-item[aria-label="Settings"]')).toBeVisible();
    });

    test('has the item navigation input', async ({ page }) => {
      await expect(page.getByRole('textbox', { name: 'Navigate to item' })).toBeVisible();
    });
  });

  test.describe('LeftBar', () => {
    test('renders the LeftBar nav', async ({ page }) => {
      await expect(page.locator('nav.LeftBar')).toBeVisible();
    });

    const leftBarItems = [
      'Tree', 'Types', 'Table', 'Functions', 'Diagram',
      'Combinator', 'AI', 'Graph', 'Quality', 'Claude', 'PR',
    ];

    for (const label of leftBarItems) {
      test(`has a ${label} button`, async ({ page }) => {
        // Scope to .LeftBar-item — HomeView renders duplicate shortcut buttons
        await expect(page.locator(`.LeftBar-item[aria-label="${label}"]`)).toBeVisible();
      });
    }
  });

  test.describe('BottomBar', () => {
    test('renders the BottomBar nav', async ({ page }) => {
      await expect(page.locator('nav.BottomBar')).toBeVisible();
    });

    test('has a Starred button', async ({ page }) => {
      // Scope to .BottomBar-item — HomeView also renders a Starred shortcut
      await expect(page.locator('.BottomBar-item[aria-label="Starred"]')).toBeVisible();
    });

    test('has a History button', async ({ page }) => {
      await expect(page.locator('.BottomBar-item[aria-label="History"]')).toBeVisible();
    });

    test('has a Layouts button', async ({ page }) => {
      await expect(page.locator('.BottomBar-item[aria-label="Layouts"]')).toBeVisible();
    });

    test('has a Todo button', async ({ page }) => {
      await expect(page.locator('.BottomBar-item[aria-label="Todo"]')).toBeVisible();
    });

    test('has the Kanecta logo FAB', async ({ page }) => {
      // The logo FAB is a MUI Fab component — scoped inside BottomBar nav
      await expect(page.locator('nav.BottomBar .MuiFab-root')).toBeVisible();
    });
  });
});
