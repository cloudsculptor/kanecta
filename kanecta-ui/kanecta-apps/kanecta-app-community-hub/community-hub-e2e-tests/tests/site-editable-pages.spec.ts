import { test, expect } from "@playwright/test";

// Regression guard for the 0629-merge loss: every site-editable page must be
// wrapped in SiteEditablePage so moderators get the "Edit this page" link.
// (The wrap also renders DB content when a moderator has saved any.)
const SITE_PAGES = [
  { path: "/transport", slug: "transport" },
  { path: "/education", slug: "education" },
  { path: "/community-resilience", slug: "community-resilience" },
  { path: "/local-businesses", slug: "local-businesses" },
  { path: "/local-government", slug: "local-government" },
  { path: "/social-services", slug: "social-services" },
];

test.describe("site-editable pages", () => {
  for (const { path, slug } of SITE_PAGES) {
    test(`${path} shows the moderator edit link`, async ({ page }) => {
      const apiResponse = page.waitForResponse(
        (r) => r.url().includes(`/api/pages/public/${slug}`),
        { timeout: 20_000 }
      );
      await page.goto(path);
      // the page must actually consult the pages API (proves the wrap exists)
      const res = await apiResponse;
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { owner_type?: string };
      expect(body.owner_type).toBe("site");
      // and the moderator edit link must render with the right target
      const link = page.locator(".site-page__edit-link");
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", `/site-pages/${slug}/edit`);
      // styled as the outlined button, not a bare anchor — guards the
      // .site-page SCSS block (also lost once in the 0629 merge)
      const style = await link.evaluate((el) => {
        const c = getComputedStyle(el);
        return { display: c.display, borderStyle: c.borderStyle, textDecorationLine: c.textDecorationLine };
      });
      expect(style.display).toMatch(/flex/); // computed may report flex or inline-flex
      expect(style.borderStyle).toBe("solid");
      expect(style.textDecorationLine).toBe("none");
    });
  }

  test("anonymous visitors do not see the edit link", async ({ browser }) => {
    // browser.newContext() inherits the project's storageState (Playwright
    // merges configured context options), so an empty state must be passed
    // explicitly to get a genuinely logged-out context.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/transport");
    await page.locator(".site-page").waitFor();
    await expect(page.locator(".site-page__edit-link")).toHaveCount(0);
    await ctx.close();
  });
});
