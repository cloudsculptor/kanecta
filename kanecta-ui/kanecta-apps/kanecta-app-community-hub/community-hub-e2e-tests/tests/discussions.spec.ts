import { test, expect, type Page } from "@playwright/test";

// Discussions over the kanecta backend: reads render migrated data, writes
// round-trip (socket + persisted read-back), and deletes/archives disappear
// for good (item_archive machinery on the kanecta side).
//
// Write tests create their own data in "Test Thread" (designated for testing)
// and delete it again — the suite leaves no residue beyond read markers.

const MARK = `e2e-${Date.now()}`;

async function openDiscussions(page: Page): Promise<void> {
  await page.goto("/discussions");
  await page.locator(".discussions-thread-item").first().waitFor();
}

async function openThread(page: Page, name: string): Promise<void> {
  await page
    .locator(".discussions-thread-item", {
      has: page.locator(".discussions-thread-item__name", { hasText: name }),
    })
    .first()
    .click();
  await page.locator(".discussions-main .discussions-input__field").waitFor();
  await page.locator(".discussions-message").first().waitFor({ timeout: 15_000 });
}

test.describe("discussions reads", () => {
  test("threads sidebar renders threads with numeric unread badges", async ({ page }) => {
    await openDiscussions(page);
    expect(await page.locator(".discussions-thread-item").count()).toBeGreaterThan(0);
    for (const b of await page.locator(".discussions-nav-item__badge").allTextContents()) {
      expect(b.trim()).toMatch(/^\d*$/);
    }
  });

  test("thread history renders: messages, emojis, reply counts", async ({ page }) => {
    await openDiscussions(page);
    await openThread(page, "Test Thread");
    expect(await page.locator(".discussions-message").count()).toBeGreaterThan(0);
    // the dev test thread carries the historical emoji test message
    await expect(
      page.locator(".discussions-message", { hasText: "Do inline emojis work" }).first()
    ).toBeVisible();
    await expect(
      page.locator(".discussions-message__reply-link").first()
    ).toBeVisible();
  });

  test("message attachments load from /api/files/ (migrated bytes)", async ({ page }) => {
    await openDiscussions(page);
    // Proposed Features holds a known pre-migration image attachment
    await openThread(page, "Proposed Features");
    const img = page.locator(".discussions-main__messages img[src*='/api/files/']").first();
    await img.waitFor({ timeout: 15_000 });
    await expect
      .poll(
        () => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0),
        { timeout: 15_000 }
      )
      .toBe(true);
  });
});

test.describe("discussions writes (Test Thread lifecycle)", () => {
  test("post → persist → edit → reply → react → delete", async ({ page }) => {
    test.setTimeout(120_000);
    await openDiscussions(page);
    await openThread(page, "Test Thread");

    // clean up residue from any earlier failed runs before asserting
    for (let i = 0; i < 10; i++) {
      const stale = page.locator(".discussions-message", { hasText: /e2e-\d+/ }).first();
      if ((await stale.count()) === 0) break;
      await stale.hover();
      await stale.locator('button[title="Delete"]').click();
      await page.waitForTimeout(800);
    }
    const input = page.locator(".discussions-main .discussions-input__field").first();
    const send = page.locator(".discussions-main .discussions-input__send").first();
    const myMsg = page.locator(".discussions-message", { hasText: MARK }).first();

    // post (socket delivery)
    await input.fill(`${MARK} lifecycle message 🧪`);
    await send.click();
    await myMsg.waitFor({ timeout: 10_000 });

    // persisted read-back
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await openThread(page, "Test Thread");
    await myMsg.waitFor({ timeout: 10_000 });

    // edit
    await myMsg.hover();
    await myMsg.locator('button[title="Edit"]').click();
    const editBox = page.locator(".discussions-message__edit-input");
    await editBox.fill(`${MARK} edited 🧪`);
    await editBox.press("Enter");
    await expect(page.locator(".discussions-message", { hasText: `${MARK} edited` }).first()).toBeVisible();
    await expect(myMsg.locator(".discussions-message__edited")).toBeVisible();

    // reply increments the parent count
    await myMsg.hover();
    await myMsg.locator('button[title="Reply in thread"]').click();
    await page.locator(".discussions-reply-panel__replies, .discussions-reply-panel__empty").first().waitFor();
    await page.locator(".discussions-reply-panel .discussions-input__field").fill(`${MARK} reply`);
    await page.locator(".discussions-reply-panel .discussions-input__send").click();
    await expect(
      page.locator(".discussions-reply-panel .discussions-message", { hasText: `${MARK} reply` }).first()
    ).toBeVisible();
    await page.locator(".discussions-reply-panel__close").click();
    await expect(myMsg.locator(".discussions-message__reply-link")).toHaveText(/1\s+repl/, { timeout: 10_000 });

    // react, then remove the reaction via the chip
    await myMsg.hover();
    await myMsg.locator('button[title="Add reaction"]').click();
    const picker = page.locator("em-emoji-picker");
    await picker.waitFor();
    await picker.locator('button[aria-label*="+1"], button[aria-label*="thumbs up"]').first().click();
    await expect(myMsg.locator(".discussions-reaction").first()).toBeVisible();
    await myMsg.locator(".discussions-reaction").first().click();
    await expect(myMsg.locator(".discussions-reaction")).toHaveCount(0);

    // delete: gone now AND after a hard refresh (item_archive physical move)
    await myMsg.hover();
    await myMsg.locator('button[title="Delete"]').click();
    await expect(page.locator(".discussions-message", { hasText: MARK })).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await openThread(page, "Test Thread");
    await expect(page.locator(".discussions-message", { hasText: MARK })).toHaveCount(0, { timeout: 10_000 });
  });

  test("create thread → post → archive removes it from the sidebar", async ({ page }) => {
    test.setTimeout(120_000);
    const threadName = `${MARK} thread`;
    await openDiscussions(page);
    // two buttons share this label; the mobile one is hidden on desktop
    await page.locator('[aria-label="New thread"]:visible').click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    await dlg.locator("input").first().fill(threadName);
    await dlg.getByRole("button", { name: /create/i }).click();
    await page.locator(".discussions-thread-item__name", { hasText: MARK }).first().waitFor({ timeout: 10_000 });

    await openThread(page, threadName);
    await page.locator(".discussions-main .discussions-input__field").fill(`${MARK} first post`);
    await page.locator(".discussions-main .discussions-input__send").click();
    await expect(page.locator(".discussions-message", { hasText: `${MARK} first post` }).first()).toBeVisible();

    await page.locator('[aria-label="Thread options"]').click();
    await page.getByRole("menuitem", { name: /archive thread/i }).click();
    await page.getByRole("button", { name: /^archive$/i }).click();
    await expect(page.locator(".discussions-thread-item__name", { hasText: MARK })).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await expect(page.locator(".discussions-thread-item__name", { hasText: MARK })).toHaveCount(0);
  });
});
