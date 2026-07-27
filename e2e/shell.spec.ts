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

test.describe("auth gating", () => {
  // Every screen that can show financial data must be unreachable signed out.
  for (const path of ["/dashboard", "/upload", "/transactions", "/settings"]) {
    test(`${path} redirects a signed-out visitor to login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("button", { name: /send sign-in link/i })).toBeVisible();
    });
  }

  test("login preserves the intended destination", async ({ page }) => {
    await page.goto("/upload");
    await expect(page).toHaveURL(/next=%2Fupload/);
  });
});

test.describe("mobile ergonomics", () => {
  test("primary actions clear the 44px touch target floor", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "touch sizing only matters on the phone viewport");

    await page.goto("/");
    for (const name of [/get started/i, /see the dashboard/i]) {
      const box = await page.getByRole("link", { name }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("the sign-in field and button are thumb-sized", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "touch sizing only matters on the phone viewport");

    await page.goto("/login");
    const email = await page.getByLabel(/email/i).boundingBox();
    const submit = await page
      .getByRole("button", { name: /send sign-in link/i })
      .boundingBox();

    expect(email!.height).toBeGreaterThanOrEqual(44);
    expect(submit!.height).toBeGreaterThanOrEqual(44);
  });
});
