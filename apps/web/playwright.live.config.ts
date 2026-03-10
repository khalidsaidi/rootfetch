import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.ROOTFETCH_BASE_URL || "https://rootfetch.com";

export default defineConfig({
  testDir: "./tests/live",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

