import { test, expect } from "@playwright/test";

/**
 * Shell-level guarantees that hold on every screen. The mobile project runs at
 * a 375px-class viewport, so these double as the mobile-first regression net.
 */

test.describe("landing page", () => {
  test("renders the value proposition and entry points", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /one honest ledger/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /get started/i })).toBeVisible();
  });

  test("get started leads to onboarding", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /get started/i }).click();
    await expect(page).toHaveURL(/\/onboarding/);
  });
});

test.describe("no horizontal overflow", () => {
  // A page that scrolls sideways on a phone is the most common mobile-first
  // regression, and it never shows up in unit tests.
  for (const path of ["/", "/onboarding", "/dashboard", "/upload", "/transactions", "/settings"]) {
    test(`${path} does not scroll horizontally`, async ({ page }) => {
      const response = await page.goto(path);
      // Auth-gated routes may redirect; that is fine, we still check the result.
      expect(response?.status() ?? 200).toBeLessThan(500);
      await page.waitForLoadState("domcontentloaded");

      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });
      // Allow a 1px rounding tolerance from sub-pixel layout.
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("mobile navigation", () => {
  test("bottom tab bar exposes the primary destinations", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "tab bar is mobile-only; desktop uses the side rail");

    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" }).last();
    await expect(nav).toBeVisible();

    for (const label of ["Dashboard", "Activity", "Upload", "Settings"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("tab targets meet the 44px minimum touch size", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "touch sizing only applies to the mobile tab bar");

    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" }).last();
    const links = await nav.getByRole("link").all();
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
