import { test, expect } from '@playwright/test';
import { setupApp } from './helpers';

test.describe('QuickCapture', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('is not visible on initial load', async ({ page }) => {
    await expect(page.getByRole('dialog', { name: 'Quick capture' })).not.toBeVisible();
  });

  test.describe('opening', () => {
    test('opens when the Capture button in TopBar is clicked', async ({ page }) => {
      await page.getByRole('button', { name: 'Capture' }).click();
      await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
    });

    test('opens on Ctrl+Space keyboard shortcut', async ({ page }) => {
      await page.keyboard.press('Control+Space');
      await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
    });

    test('focuses the input automatically when opened', async ({ page }) => {
      await page.getByRole('button', { name: 'Capture' }).click();
      // Small delay for the setTimeout(focus, 10) in QuickCapture
      await page.waitForTimeout(50);
      const input = page.getByRole('textbox', { name: 'Item value' });
      await expect(input).toBeFocused();
    });

    test('input is empty when opened', async ({ page }) => {
      await page.getByRole('button', { name: 'Capture' }).click();
      const input = page.getByRole('textbox', { name: 'Item value' });
      await expect(input).toHaveValue('');
    });
  });

  test.describe('closing', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: 'Capture' }).click();
      await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
    });

    test('closes on Escape key', async ({ page }) => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Quick capture' })).not.toBeVisible();
    });

    test('closes when the Cancel button is clicked', async ({ page }) => {
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('dialog', { name: 'Quick capture' })).not.toBeVisible();
    });

    test('closes when the backdrop is clicked', async ({ page }) => {
      await page.locator('.QuickCapture__backdrop').click();
      await expect(page.getByRole('dialog', { name: 'Quick capture' })).not.toBeVisible();
    });
  });

  test.describe('submitting', () => {
    test('Capture button is disabled when input is empty', async ({ page }) => {
      await page.getByRole('button', { name: 'Capture' }).first().click();
      const captureSubmitBtn = page.locator('.QuickCapture__footer').getByRole('button', { name: 'Capture' });
      await expect(captureSubmitBtn).toBeDisabled();
    });

    test('Capture button is enabled when input has text', async ({ page }) => {
      await page.getByRole('button', { name: 'Capture' }).click();
      await page.getByRole('textbox', { name: 'Item value' }).fill('My new idea');
      const captureSubmitBtn = page.locator('.QuickCapture__footer').getByRole('button', { name: 'Capture' });
      await expect(captureSubmitBtn).toBeEnabled();
    });

    test('submits via button click and calls POST /api/items', async ({ page }) => {
      let capturedBody: unknown;
      await page.route(
        (url) => url.pathname === '/api/items' && page.url().includes('5174'),
        async (route) => {
          if (route.request().method() === 'POST') {
            capturedBody = route.request().postDataJSON();
            await route.fulfill({ status: 201, json: { id: 'new-id', value: 'My new idea', type: 'text' } });
          } else {
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
          }
        },
      );

      await page.getByRole('button', { name: 'Capture' }).click();
      await page.getByRole('textbox', { name: 'Item value' }).fill('My new idea');
      await page.locator('.QuickCapture__footer').getByRole('button', { name: 'Capture' }).click();

      await expect(page.getByRole('dialog', { name: 'Quick capture' })).not.toBeVisible();
      expect(capturedBody).toMatchObject({ value: 'My new idea', type: 'text' });
    });

    test('submits via Enter key and calls POST /api/items', async ({ page }) => {
      let postCount = 0;
      await page.route(
        (url) => url.pathname === '/api/items',
        async (route) => {
          if (route.request().method() === 'POST') {
            postCount++;
            await route.fulfill({ status: 201, json: { id: 'new-id', value: 'Keyboard capture', type: 'text' } });
          } else {
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
          }
        },
      );

      await page.getByRole('button', { name: 'Capture' }).click();
      await page.getByRole('textbox', { name: 'Item value' }).fill('Keyboard capture');
      await page.keyboard.press('Enter');

      await expect(page.getByRole('dialog', { name: 'Quick capture' })).not.toBeVisible();
      expect(postCount).toBe(1);
    });

    test('does not submit when input is only whitespace', async ({ page }) => {
      await page.getByRole('button', { name: 'Capture' }).click();
      await page.getByRole('textbox', { name: 'Item value' }).fill('   ');
      await page.keyboard.press('Enter');
      // dialog should remain open
      await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
    });

    test('input is cleared when re-opened after a submission', async ({ page }) => {
      await page.route(
        (url) => url.pathname === '/api/items',
        async (route) => {
          if (route.request().method() === 'POST') {
            await route.fulfill({ status: 201, json: { id: 'new-id', value: 'First capture', type: 'text' } });
          } else {
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
          }
        },
      );

      // First capture
      await page.getByRole('button', { name: 'Capture' }).click();
      await page.getByRole('textbox', { name: 'Item value' }).fill('First capture');
      await page.locator('.QuickCapture__footer').getByRole('button', { name: 'Capture' }).click();
      await expect(page.getByRole('dialog', { name: 'Quick capture' })).not.toBeVisible();

      // Re-open
      await page.getByRole('button', { name: 'Capture' }).click();
      await expect(page.getByRole('textbox', { name: 'Item value' })).toHaveValue('');
    });
  });
});
