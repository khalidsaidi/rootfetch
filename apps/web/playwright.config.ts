import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["tests/live/**"],
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4781",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "NEXT_PUBLIC_GA_MEASUREMENT_ID=G-TEST12345 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:4781 npm run dev -- --port 4781 --hostname 127.0.0.1",
    cwd: ".",
    url: "http://127.0.0.1:4781",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
