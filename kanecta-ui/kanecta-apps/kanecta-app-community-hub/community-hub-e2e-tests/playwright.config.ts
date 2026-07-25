import { defineConfig, devices } from "@playwright/test";

// Target environment. Defaults to nonprod — NEVER point E2E_BASE_URL at prod.
const baseURL = process.env.E2E_BASE_URL ?? "https://test.featherston.co.nz";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "authenticated",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/state.json",
      },
    },
  ],
});
