import { test, expect, type Page } from "@playwright/test";

// §6 of the nonprod test plan: notice lifecycle — create (pending) → moderator
// approve → public; decline another; author delete removes both. Deletes are
// payload soft-deletes (deleted_at field), mirroring legacy — item_archive is
// not involved. The tester account carries the moderator role, so one session
// plays both author and moderator.

const MARK = `e2e-${Date.now()}`;
// avoid the words "approve"/"decline" in headings — getByRole name matching
// is substring by default and the accordion-summary button's accessible name
// contains the heading
const NOTICE_A = `${MARK} notice alpha`;
const NOTICE_B = `${MARK} notice beta`;

async function createNotice(page: Page, heading: string): Promise<void> {
  await page.goto("/notice-board");
  await page.locator(".notice-inline-form").waitFor();
  // the auth-gate overlay must NOT be up for a verified, signed-in tester
  await expect(page.locator(".notice-inline-form__overlay")).toHaveCount(0);
  await page.getByLabel("Heading").fill(heading);
  await page.getByLabel("Notice text").fill(`${heading} — body text for the automated §6 round.`);
  await page.getByRole("button", { name: "Submit notice" }).click();
  await expect(page.locator(".notice-inline-form .MuiAlert-root")).toBeVisible({ timeout: 10_000 });
}

async function deleteMyNotice(page: Page, heading: string): Promise<void> {
  const row = page.locator(".my-notice-row", { hasText: heading }).first();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.locator(".my-notice-row", { hasText: heading })).toHaveCount(0, { timeout: 10_000 });
}

test.describe("notices (§6 lifecycle)", () => {
  test("create → approve → public; decline another; delete both", async ({ page }) => {
    test.setTimeout(150_000);

    // create two pending notices
    await createNotice(page, NOTICE_A);
    await createNotice(page, NOTICE_B);
    await expect(page.locator(".my-notice-row", { hasText: NOTICE_A })).toBeVisible();
    await expect(
      page.locator(".my-notice-row", { hasText: NOTICE_A }).locator(".MuiChip-root", { hasText: "Pending review" })
    ).toBeVisible();

    // moderator: approve A, decline B (with a reason)
    await page.goto("/approvals");
    const cardA = page.locator(".MuiAccordion-root", { hasText: NOTICE_A }).first();
    await cardA.waitFor({ timeout: 10_000 });
    await cardA.click();
    // let the accordion finish expanding before clicking, or the click can
    // land mid-animation and miss
    await expect(cardA.locator(".MuiAccordionSummary-root")).toHaveAttribute("aria-expanded", "true");
    await cardA.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator(".MuiAccordion-root", { hasText: NOTICE_A })).toHaveCount(0, { timeout: 10_000 });

    const cardB = page.locator(".MuiAccordion-root", { hasText: NOTICE_B }).first();
    await cardB.click();
    await cardB.getByRole("button", { name: "Decline", exact: true }).click();
    await cardB.getByLabel(/Reason for declining/).fill("e2e automated decline");
    await cardB.getByRole("button", { name: "Confirm decline" }).click();
    await expect(page.locator(".MuiAccordion-root", { hasText: NOTICE_B })).toHaveCount(0, { timeout: 10_000 });

    // A is now public; B shows as declined for its author
    await page.goto("/notice-board");
    await expect(page.locator(".notice-card", { hasText: NOTICE_A }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".notice-card", { hasText: NOTICE_B })).toHaveCount(0);
    await expect(
      page.locator(".my-notice-row", { hasText: NOTICE_B }).locator(".MuiChip-root", { hasText: "Declined" })
    ).toBeVisible();

    // author delete removes both, from my-notices AND the public list, and
    // they stay gone after a hard refresh
    await deleteMyNotice(page, NOTICE_A);
    await deleteMyNotice(page, NOTICE_B);
    await expect(page.locator(".notice-card", { hasText: NOTICE_A })).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await page.locator(".notice-inline-form").waitFor();
    await expect(page.locator(".notice-card", { hasText: MARK })).toHaveCount(0);
    await expect(page.locator(".my-notice-row", { hasText: MARK })).toHaveCount(0);
  });
});
