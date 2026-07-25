import { test, expect, type Page } from "@playwright/test";

// §10 of the nonprod test plan: notification preference toggles persist, and
// thread subscribe/unsubscribe round-trips. Headless Chromium has no real
// push service, so PushManager is stubbed at the browser level — every
// server-side write (device save, preference save, thread subscription
// create/delete) is real. Push DELIVERY is disabled on nonprod by design, so
// the stubbed endpoint never matters. Thread unsubscribe is one of the few
// paths that hard-deletes a kanecta item (the subscription item).

const MARK = `e2e-${Date.now()}`;

test.use({ permissions: ["notifications"] });

async function stubPush(page: Page): Promise<void> {
  await page.addInitScript((mark) => {
    // this Chromium headless build reports Notification.permission "denied"
    // even when the context grants it — stub the whole permission surface
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
    Notification.requestPermission = async () => "granted";
    const FLAG = "e2e-push-subscribed";
    const fakeSub = {
      endpoint: `https://e2e-push.invalid/${mark}`,
      expirationTime: null,
      getKey: () => new Uint8Array(16).buffer,
      toJSON: () => ({
        endpoint: `https://e2e-push.invalid/${mark}`,
        expirationTime: null,
        // syntactically valid dummy keys — delivery is off on nonprod
        keys: { p256dh: "BE".padEnd(87, "A"), auth: "e2e-auth-0123456789ab" },
      }),
      unsubscribe: async () => (localStorage.removeItem(FLAG), true),
    };
    const fakePushManager = {
      subscribe: async () => (localStorage.setItem(FLAG, "1"), fakeSub),
      getSubscription: async () => (localStorage.getItem(FLAG) ? fakeSub : null),
    };
    // navigator.serviceWorker.ready never resolves in this environment (no
    // real SW registration), which would hang the app's subscribe path —
    // replace the whole serviceWorker surface with a fake registration.
    // The "subscribed" flag lives in localStorage so it survives reloads
    // within a test (each test gets a fresh context, so runs stay isolated).
    const fakeReg = { pushManager: fakePushManager, unregister: async () => true };
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve(fakeReg),
        getRegistration: async () => fakeReg,
        register: async () => fakeReg,
        addEventListener: () => {},
        removeEventListener: () => {},
        controller: null,
      },
    });
  }, MARK);
}

test.describe("preferences (§10)", () => {
  test("settings: enable push, per-category toggle persists across reload, then disable", async ({ page }) => {
    test.setTimeout(120_000);
    await stubPush(page);
    await page.goto("/settings");
    await page.getByRole("heading", { name: "Notifications" }).waitFor({ timeout: 15_000 });

    // enable push — the stub "subscribes" and the app saves the device server-side
    const globalToggle = page.getByLabel("Enable push notifications");
    await globalToggle.waitFor({ timeout: 10_000 });
    if (!(await globalToggle.isChecked())) await globalToggle.click();

    // per-category rows appear once subscribed
    const discussionsRow = page.getByText("Discussions — new threads");
    await discussionsRow.waitFor({ timeout: 15_000 });
    // switches render in a fixed order: global, then Events / Discussions /
    // Suggestions / Pages — the row Box holds only a <p> and the Switch, so
    // positional selection is the stable option. MUI Switch inputs carry an
    // explicit role="switch" (not checkbox).
    const discussionsToggle = page.getByRole("switch").nth(2);
    const before = await discussionsToggle.isChecked();
    await discussionsToggle.click();
    await page.waitForTimeout(1500); // let the save land

    // survives a hard refresh (server-side persistence, not component state)
    await page.reload();
    await discussionsRow.waitFor({ timeout: 15_000 });
    await expect(discussionsToggle).toBeChecked({ checked: !before, timeout: 10_000 });

    // restore the original value and verify it also persists
    await discussionsToggle.click();
    await page.waitForTimeout(1500);
    await page.reload();
    await discussionsRow.waitFor({ timeout: 15_000 });
    await expect(discussionsToggle).toBeChecked({ checked: before, timeout: 10_000 });

    // disable push again — removes the e2e device record server-side
    const globalAfter = page.getByLabel("Enable push notifications");
    if (await globalAfter.isChecked()) await globalAfter.click();
    await page.waitForTimeout(1500);
  });

  test("thread bell: subscribe persists across reload, unsubscribe round-trips", async ({ page }) => {
    test.setTimeout(120_000);
    await stubPush(page);
    await page.goto("/discussions");
    await page.locator(".discussions-thread-item").first().waitFor();
    const openTestThread = async () => {
      await page
        .locator(".discussions-thread-item", {
          has: page.locator(".discussions-thread-item__name", { hasText: "Test Thread" }),
        })
        .first()
        .click();
      await page.locator(".discussions-main .discussions-input__field").waitFor();
    };
    await openTestThread();

    const bell = page.locator("button.discussions-bell");
    await bell.waitFor({ timeout: 10_000 });

    // normalise: start unsubscribed
    if ((await bell.getAttribute("class"))?.includes("discussions-bell--on")) {
      await bell.click();
      await expect(bell).not.toHaveClass(/discussions-bell--on/, { timeout: 10_000 });
    }

    // subscribe — creates the thread-notification-subscription item
    await bell.click();
    await expect(bell).toHaveClass(/discussions-bell--on/, { timeout: 10_000 });

    // server truth: still on after a hard refresh
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await openTestThread();
    await expect(bell).toHaveClass(/discussions-bell--on/, { timeout: 10_000 });

    // unsubscribe — hard-deletes the subscription item — and verify it sticks
    await bell.click();
    await expect(bell).not.toHaveClass(/discussions-bell--on/, { timeout: 10_000 });
    await page.reload();
    await page.locator(".discussions-thread-item").first().waitFor();
    await openTestThread();
    await expect(bell).not.toHaveClass(/discussions-bell--on/, { timeout: 10_000 });
  });
});
