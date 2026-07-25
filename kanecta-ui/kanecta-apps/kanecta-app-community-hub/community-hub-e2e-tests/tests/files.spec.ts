import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";

// §4 of the nonprod test plan: the native file write path. Uploads land in the
// bucket under an item-id key via kanecta (no legacy path), previews render,
// downloads return identical bytes, unicode filenames survive, and an explicit
// file delete makes the bytes unreachable. Pre-existing migrated-byte reads are
// covered by discussions.spec.ts (attachment image) and finances.spec.ts
// (invoice PDFs).

const MARK = `e2e-${Date.now()}`;

// 1×1 red PNG — small but a real, decodable image.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const TXT_BYTES = Buffer.from(`kanecta e2e byte-identity probe ${MARK} — tēnā koe 日本語 ✓\n`, "utf8");

const IMG_NAME = `${MARK} test image.png`;
// spaces survive; non-ASCII does NOT (see the fixme test below)
const TXT_NAME = `${MARK} test doc with spaces.txt`;
const UNICODE_NAME = `${MARK} tēst döc ✓.txt`;

// Each test uses its own scratch thread (archived afterwards): Test Thread is
// past the 50-message list window (ASC LIMIT 50, no load-older — latent
// legacy-identical bug), and writing there would also pile up tombstones.
async function createScratchThread(page: Page, name: string): Promise<void> {
  await page.goto("/discussions");
  await page.locator(".discussions-thread-item").first().waitFor();
  await page.locator('[title="New thread"]:visible, [aria-label="New thread"]:visible').first().click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor();
  await dlg.locator("input").first().fill(name);
  await dlg.getByRole("button", { name: /create/i }).click();
  await page.locator(".discussions-main .discussions-input__field").waitFor();
}

async function archiveCurrentThread(page: Page, name: string): Promise<void> {
  await page.locator('[aria-label="Thread options"]').click();
  await page.getByRole("menuitem", { name: /archive thread/i }).click();
  await page.getByRole("button", { name: /^archive$/i }).click();
  await expect(page.locator(".discussions-thread-item__name", { hasText: name })).toHaveCount(0, {
    timeout: 10_000,
  });
}

async function deleteMessage(page: Page, msg: ReturnType<Page["locator"]>): Promise<void> {
  await msg.hover();
  await msg.locator('button[title="Delete"]').click();
  await page.waitForTimeout(800);
}

test.describe("files (§4 native write path)", () => {
  test("image upload: preview renders, then explicit file delete kills the bytes", async ({ page }) => {
    test.setTimeout(90_000);
    const threadName = `${MARK} files-img`;
    await createScratchThread(page, threadName);

    await page.locator(".discussions-main input[type=file]").setInputFiles({
      name: IMG_NAME,
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    // wait for the pending chip to finish uploading before sending
    await expect(page.locator(".discussions-attachment-item__status")).toHaveCount(0, { timeout: 20_000 });
    await page.locator(".discussions-main .discussions-input__field").fill(`${MARK} image upload`);
    await page.locator(".discussions-main .discussions-input__send").click();

    const myMsg = page.locator(".discussions-message", { hasText: `${MARK} image upload` }).first();
    await myMsg.waitFor({ timeout: 10_000 });
    const img = myMsg.locator("img.discussions-message-file__image");
    await img.waitFor({ timeout: 15_000 });
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0), {
        timeout: 15_000,
      })
      .toBe(true);
    const imgUrl = await img.getAttribute("src");
    expect(imgUrl).toBeTruthy();

    // bytes are reachable while the file lives
    const preStatus = await page.evaluate(async (u) => (await fetch(u!)).status, imgUrl);
    expect(preStatus).toBe(200);

    // explicit file delete (hover the image to reveal the action buttons)
    await img.hover();
    await myMsg.locator('button[title="Delete file"]').click();
    await expect(myMsg.locator(".discussions-message-file")).toHaveCount(0, { timeout: 10_000 });

    // the bytes must now be unreachable — the file item and blob are gone
    await expect
      .poll(async () => page.evaluate(async (u) => (await fetch(u!)).status, imgUrl), { timeout: 15_000 })
      .not.toBe(200);

    await deleteMessage(page, myMsg);
    await archiveCurrentThread(page, threadName);
  });

  // KNOWN PRE-EXISTING BUG (legacy-identical, not a cutover regression):
  // multer's default busboy defParamCharset is latin1, so UTF-8 multipart
  // filenames mojibake ("tēst döc ✓" → "tÄst dÃ¶c â"). One-line fix in
  // community-hub-api routes/discussions.js:
  //   Buffer.from(req.file.originalname, "latin1").toString("utf8")
  // Un-fixme this test once applied.
  test.fixme("unicode filename survives upload round-trip", async ({ page }) => {
    const threadName = `${MARK} files-unicode`;
    await createScratchThread(page, threadName);
    await page.locator(".discussions-main input[type=file]").setInputFiles({
      name: UNICODE_NAME,
      mimeType: "text/plain",
      buffer: TXT_BYTES,
    });
    await expect(page.locator(".discussions-attachment-item__status")).toHaveCount(0, { timeout: 20_000 });
    await page.locator(".discussions-main .discussions-input__field").fill(`${MARK} unicode upload`);
    await page.locator(".discussions-main .discussions-input__send").click();
    const msg = page.locator(".discussions-message", { hasText: `${MARK} unicode upload` }).first();
    await msg.waitFor({ timeout: 10_000 });
    await expect(msg.locator("button.discussions-message-file__chip-name")).toHaveText(UNICODE_NAME, {
      timeout: 15_000,
    });
    await deleteMessage(page, msg);
  });

  test("non-image upload: spaced name survives, download bytes identical, delete hides it", async ({ page }) => {
    test.setTimeout(90_000);
    const threadName = `${MARK} files-doc`;
    await createScratchThread(page, threadName);

    await page.locator(".discussions-main input[type=file]").setInputFiles({
      name: TXT_NAME,
      mimeType: "text/plain",
      buffer: TXT_BYTES,
    });
    await expect(page.locator(".discussions-attachment-item__status")).toHaveCount(0, { timeout: 20_000 });
    await page.locator(".discussions-main .discussions-input__field").fill(`${MARK} doc upload`);
    await page.locator(".discussions-main .discussions-input__send").click();

    const myMsg = page.locator(".discussions-message", { hasText: `${MARK} doc upload` }).first();
    await myMsg.waitFor({ timeout: 10_000 });

    // the chip keeps the odd filename verbatim
    const chipName = myMsg.locator("button.discussions-message-file__chip-name");
    await expect(chipName).toHaveText(TXT_NAME, { timeout: 15_000 });

    // download and compare byte-for-byte with what was uploaded
    const [download] = await Promise.all([page.waitForEvent("download"), chipName.click()]);
    expect(download.suggestedFilename()).toBe(TXT_NAME);
    const downloadPath = await download.path();
    expect(fs.readFileSync(downloadPath!).equals(TXT_BYTES)).toBe(true);

    // deleting the message tombstones it — the attachment stops rendering,
    // now and after a hard refresh
    await deleteMessage(page, myMsg);
    await expect(page.locator(".discussions-message", { hasText: `${MARK} doc upload` })).toHaveCount(0);
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await expect(page.locator(".discussions-message-file__chip-name", { hasText: MARK })).toHaveCount(0);

    // reopen the scratch thread and archive it
    await page
      .locator(".discussions-thread-item", {
        has: page.locator(".discussions-thread-item__name", { hasText: threadName }),
      })
      .first()
      .click();
    await page.locator(".discussions-main .discussions-input__field").waitFor();
    await archiveCurrentThread(page, threadName);
  });
});
