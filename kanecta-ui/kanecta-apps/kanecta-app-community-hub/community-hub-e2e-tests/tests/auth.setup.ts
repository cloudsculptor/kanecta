import { test as setup, expect } from "@playwright/test";

// Logs in via Keycloak with the dedicated tester account and saves the
// session for the authenticated project. Credentials come from env:
//   E2E_USERNAME / E2E_PASSWORD  (the tester realm account — never a real member)
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

setup("authenticate as tester", async ({ page }) => {
  if (!username || !password) {
    throw new Error("E2E_USERNAME and E2E_PASSWORD must be set (tester realm account)");
  }
  await page.goto("/");
  // header settles into either logged-in or logged-out state
  await page
    .locator('header button')
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/auth\.featherston\.co\.nz/);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
  await page.waitForURL((u) => !u.href.includes("auth.featherston.co.nz"));
  // logged-in header shows the user's first name instead of Log in
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toHaveCount(0);
  await page.context().storageState({ path: ".auth/state.json" });
});
