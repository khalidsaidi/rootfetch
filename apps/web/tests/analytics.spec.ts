import { expect, test } from "@playwright/test";

test("analytics events fire on core product interactions", async ({ page }) => {
  const events = new Set<string>();
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route("**://www.google-analytics.com/g/collect**", async (route) => {
    const url = new URL(route.request().url());
    const eventName = url.searchParams.get("en");
    if (eventName) {
      events.add(eventName);
    }
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("link", { name: /for teams/i }).first().click();
  await page.waitForURL("**/for-teams");

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("link", { name: /coverage universe/i }).first().click();
  await page.waitForURL("**/coverage");

  await page.getByTestId("approved-search-input").fill("app");
  await page.waitForTimeout(700);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const operatorFeeds = page
    .locator("details")
    .filter({ hasText: "Operator feeds and command console" })
    .first();
  await operatorFeeds.locator("summary").click();
  await page.getByRole("link", { name: "Open full digest" }).click();
  await page.waitForURL("**/rootfetch/latest.md");

  await page.goto("/ask");
  await page.getByTestId("ask-input").fill("What changed today?");
  await page.getByTestId("ask-submit").click();
  await page.waitForTimeout(1200);

  // flush events
  await page.waitForTimeout(1000);

  expect(events.has("page_view")).toBeTruthy();
  expect(events.has("rf_nav_click")).toBeTruthy();
  expect(events.has("rf_open_approved")).toBeTruthy();
  expect(events.has("rf_open_digest") || events.has("rf_read_digest")).toBeTruthy();
  expect(events.has("rf_approved_search")).toBeTruthy();
  expect(events.has("rf_ask_submit")).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
