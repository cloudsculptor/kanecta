import { test, expect, type Page } from "@playwright/test";

// Discussions over the kanecta backend: reads render migrated data, writes
// round-trip (socket + persisted read-back), and deletes/archives disappear
// from the UI for good. NOTE: message deletes and thread archives are payload
// soft-deletes (deleted_at/archived_at fields in the obj row), faithfully
// mirroring the legacy pg backend — they intentionally do NOT go through
// kanecta's item_archive. Only hard deletes (reaction removal, unsubscribes,
// file-link cleanup) touch kanecta item deletion, and those are hard —
// item_archive is never written by this app.
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

test.describe("discussions writes (scratch-thread lifecycle)", () => {
  // Two KNOWN pre-existing UI bugs (identical in the legacy pg backend — not
  // cutover regressions; verified 2026-07-25 against both code paths):
  //  1. Editing a message replaces it in state with the PUT response, which
  //     (like legacy `RETURNING *`) carries no reply_count — so the parent's
  //     reply-count link vanishes until reload. The test therefore replies
  //     BEFORE editing and never asserts the link post-edit.
  //  2. A posted reply increments the sender's count twice live (HTTP callback
  //     + message:reply_count socket event both fire) — live count may read
  //     "2 replies" after one reply; the reload assertion checks server truth.
  // Deletes are payload soft-deletes (tombstones), mirroring legacy — they do
  // NOT move rows to item_archive, so no archive assertions belong here.
  //
  // The lifecycle runs in its OWN thread (created here, archived at the end):
  // the messages list serves the OLDEST 50 top-level rows (ASC LIMIT 50 with
  // no load-older in the client — a latent legacy-identical bug), so writing
  // into the >50-message Test Thread would make read-backs invisible. A
  // scratch thread also stops tombstone build-up in Test Thread.
  test("post → persist → reply → edit → react → delete", async ({ page }) => {
    test.setTimeout(120_000);
    const threadName = `${MARK} lifecycle`;
    await openDiscussions(page);
    await page.locator('[title="New thread"]:visible, [aria-label="New thread"]:visible').first().click();
    const createDlg = page.getByRole("dialog");
    await createDlg.waitFor();
    await createDlg.locator("input").first().fill(threadName);
    await createDlg.getByRole("button", { name: /create/i }).click();
    await page.locator(".discussions-main .discussions-input__field").waitFor();

    const input = page.locator(".discussions-main .discussions-input__field").first();
    const send = page.locator(".discussions-main .discussions-input__send").first();
    // hasText MARK survives the later edit ("<MARK> edited 🧪"); the panel
    // reply also matches, but the main list precedes the panel in the DOM so
    // first() stays the parent
    const myMsg = page.locator(".discussions-message", { hasText: MARK }).first();

    // post (socket delivery)
    await input.fill(`${MARK} lifecycle message 🧪`);
    await send.click();
    await myMsg.waitFor({ timeout: 10_000 });

    // persisted read-back
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await openThread(page, threadName);
    await myMsg.waitFor({ timeout: 10_000 });

    // reply increments the parent count (live count may double — bug 2)
    await myMsg.hover();
    await myMsg.locator('button[title="Reply in thread"]').click();
    await page.locator(".discussions-reply-panel__replies, .discussions-reply-panel__empty").first().waitFor();
    await page.locator(".discussions-reply-panel .discussions-input__field").fill(`${MARK} reply`);
    await page.locator(".discussions-reply-panel .discussions-input__send").click();
    const panelReply = page
      .locator(".discussions-reply-panel .discussions-message", { hasText: `${MARK} reply` })
      .first();
    await expect(panelReply).toBeVisible();
    await page.locator(".discussions-reply-panel__close").click();
    await expect(myMsg.locator(".discussions-message__reply-link")).toHaveText(/\d+\s+repl/, { timeout: 10_000 });

    // server truth after reload: exactly one reply
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await openThread(page, threadName);
    await expect(myMsg.locator(".discussions-message__reply-link")).toHaveText(/1\s+repl/, { timeout: 10_000 });

    // delete the reply again (via the panel) so the run leaves no live content
    await myMsg.locator(".discussions-message__reply-link").click();
    await panelReply.waitFor();
    await panelReply.hover();
    await panelReply.locator('button[title="Delete"]').click();
    await expect(panelReply).toHaveCount(0, { timeout: 10_000 });
    await page.locator(".discussions-reply-panel__close").click();

    // edit (last write step — the reply-link vanishes from state here, bug 1)
    await myMsg.hover();
    await myMsg.locator('button[title="Edit"]').click();
    const editBox = page.locator(".discussions-message__edit-input");
    await editBox.fill(`${MARK} edited 🧪`);
    await editBox.press("Enter");
    await expect(page.locator(".discussions-message", { hasText: `${MARK} edited` }).first()).toBeVisible();
    await expect(myMsg.locator(".discussions-message__edited")).toBeVisible();

    // react, then remove the reaction via the chip
    await myMsg.hover();
    await myMsg.locator('button[title="Add reaction"]').click();
    const picker = page.locator("em-emoji-picker");
    await picker.waitFor();
    // emoji buttons carry title="Thumbs Up" / aria-label="👍" (shadow DOM —
    // Playwright pierces open roots)
    await picker.locator('button[title="Thumbs Up"]').first().click();
    await expect(myMsg.locator(".discussions-reaction").first()).toBeVisible();
    await myMsg.locator(".discussions-reaction").first().click();
    await expect(myMsg.locator(".discussions-reaction")).toHaveCount(0);

    // delete: tombstoned now AND after a hard refresh (payload soft-delete —
    // content blanks, so the MARK no longer matches anything in the main list)
    await myMsg.hover();
    await myMsg.locator('button[title="Delete"]').click();
    await expect(page.locator(".discussions-message", { hasText: MARK })).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await openThread(page, threadName);
    await expect(page.locator(".discussions-message", { hasText: MARK })).toHaveCount(0, { timeout: 10_000 });

    // cleanup: archive the scratch thread so runs leave no sidebar residue
    await page.locator('[aria-label="Thread options"]').click();
    await page.getByRole("menuitem", { name: /archive thread/i }).click();
    await page.getByRole("button", { name: /^archive$/i }).click();
    await expect(page.locator(".discussions-thread-item__name", { hasText: threadName })).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test("create thread → post → archive removes it from the sidebar", async ({ page }) => {
    test.setTimeout(120_000);
    const threadName = `${MARK} thread`;
    await openDiscussions(page);
    // desktop sidebar "+" carries title="New thread"; only the (hidden on
    // desktop) mobile button has the aria-label — accept either, visible only
    await page.locator('[title="New thread"]:visible, [aria-label="New thread"]:visible').first().click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    await dlg.locator("input").first().fill(threadName);
    await dlg.getByRole("button", { name: /create/i }).click();
    await page.locator(".discussions-thread-item__name", { hasText: MARK }).first().waitFor({ timeout: 10_000 });

    // open directly — openThread() waits for an existing message, and a
    // freshly created thread has none yet
    await page
      .locator(".discussions-thread-item", {
        has: page.locator(".discussions-thread-item__name", { hasText: threadName }),
      })
      .first()
      .click();
    await page.locator(".discussions-main .discussions-input__field").waitFor();
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
