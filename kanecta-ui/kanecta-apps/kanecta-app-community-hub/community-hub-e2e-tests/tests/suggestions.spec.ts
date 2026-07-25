import { test, expect } from "@playwright/test";

// §7 of the nonprod test plan: suggestion lifecycle — submit from the home
// page contribute form → shows on /approvals for moderators → archive moves it
// to /suggestions/archive. Archiving is a payload status change, not an
// item_archive move. There is no delete UI for suggestions, so each run leaves
// one clearly-marked e2e row in the archive list (accepted residue).

const MARK = `e2e-${Date.now()}`;
const SUGGESTION = `${MARK} automated suggestion — please archive`;

test.describe("suggestions (§7 lifecycle)", () => {
  test("submit → appears for moderators → archive → shows in archive list", async ({ page }) => {
    test.setTimeout(120_000);

    // submit from the home-page contribute form
    await page.goto("/");
    await page.locator(".contribute-form").scrollIntoViewIfNeeded();
    await expect(page.locator(".contribute-form__overlay")).toHaveCount(0);
    await page.getByLabel("Your suggestion or message").fill(SUGGESTION);
    await page.getByRole("button", { name: "Send suggestion" }).click();
    await expect(page.locator(".contribute-form .MuiAlert-root")).toBeVisible({ timeout: 10_000 });

    // moderator sees it in the active list
    await page.goto("/approvals");
    const item = page
      .locator("div", { hasText: SUGGESTION })
      .filter({ has: page.getByRole("button", { name: "Archive" }) })
      .last();
    await item.waitFor({ timeout: 10_000 });

    // archive via the confirm dialog
    await item.getByRole("button", { name: "Archive" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await expect(dialog).toContainText("Archive this suggestion?");
    await dialog.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.locator("body")).not.toContainText(SUGGESTION, { timeout: 10_000 });

    // it moved to the archive list, attributed and dated
    await page.goto("/suggestions/archive");
    const archived = page.locator("div", { hasText: SUGGESTION }).filter({ hasText: "Archived by" }).last();
    await archived.waitFor({ timeout: 10_000 });

    // and it stays archived after a refresh — no resurrection in the active list
    await page.goto("/approvals");
    await page.getByRole("heading", { name: "Suggestions from the community" }).waitFor();
    await expect(page.locator("body")).not.toContainText(SUGGESTION);
  });
});
