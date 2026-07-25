import { test, expect } from "@playwright/test";

// §8 of the nonprod test plan: finances read surfaces. Transactions and
// recurring-expenses lists render with money formatting, invoice attachments
// download as real PDFs [K migrated bytes — including the two known-drift
// 1st Domains files], and the report page shows consistent totals. Write
// checks (create/delete transaction) need the treasurer role, which the
// tester account deliberately lacks — asserted as the role gate holding.

const MONEY = /^-?\$[\d,]+\.\d{2}$/;

test.describe("finances (§8 reads)", () => {
  test("transactions list renders with money formatting; no treasurer UI for tester", async ({ page }) => {
    await page.goto("/governance/finances/transactions");
    await page.locator("table.fin-table").waitFor({ timeout: 15_000 });
    const rows = page.locator("tr.fin-table__row");
    expect(await rows.count()).toBeGreaterThan(0);
    // scope to body rows — the header <th> also carries .fin-table__amount
    for (const amount of await page.locator("tr.fin-table__row .fin-table__amount").allTextContents()) {
      expect(amount.trim()).toMatch(MONEY);
    }
    // role gate: no add/edit/delete UI without the treasurer role
    await expect(page.locator("form.fin-form")).toHaveCount(0);
    await expect(page.locator("button.fin-table__btn")).toHaveCount(0);
  });

  test("expenses render with reference links", async ({ page }) => {
    await page.goto("/governance/finances/expenses");
    // two tables render (Monthly + Annual) — wait on the first
    await page.locator("table.fin-table").first().waitFor({ timeout: 15_000 });
    await expect(page.locator(".fin-expenses__freq-heading", { hasText: "Monthly" })).toBeVisible();
    await expect(page.locator(".fin-expenses__freq-heading", { hasText: "Annual" })).toBeVisible();
    expect(await page.locator("tr.fin-table__row").count()).toBeGreaterThan(0);
    // expense url fields are plain external reference links (supplier pricing
    // pages), NOT stored invoices — just assert they render as links
    expect(await page.locator("tr.fin-table__row a").count()).toBeGreaterThan(0);
  });

  // [K migrated bytes] The two 1st Domains invoice PDFs (the known
  // size-drift files) attach to transactions, but the UI exposes no download
  // (the Files dialog says "stored by the administrator") — so the byte
  // check goes straight at the public /api/files route. File item ids are
  // nonprod data; this suite is nonprod-only by design.
  test("transaction invoice files serve migrated PDF bytes", async ({ page }) => {
    const INVOICE_FILE_IDS = [
      "3c54b788-d268-4bec-842f-b4d91f393822",
      "b1266523-01e2-48ac-94f2-4668a3233743",
    ];
    for (const id of INVOICE_FILE_IDS) {
      const r = await page.request.get(`/api/files/${id}`);
      expect(r.status(), id).toBe(200);
      const body = await r.body();
      expect(body.subarray(0, 5).toString("latin1"), id).toBe("%PDF-");
      expect(body.length, id).toBeGreaterThan(10_000);
    }
  });

  test("profit & loss report renders sections and totals", async ({ page }) => {
    await page.goto("/governance/finances/profit-and-loss");
    await page.locator(".fin-report").waitFor({ timeout: 15_000 });
    expect(await page.locator(".fin-report__section").count()).toBeGreaterThan(0);
    const totals = page.locator(".fin-report__total");
    expect(await totals.count()).toBeGreaterThan(0);
    for (const t of await totals.allTextContents()) {
      expect(t).toMatch(/\$[\d,]+\.\d{2}/);
    }
  });
});
