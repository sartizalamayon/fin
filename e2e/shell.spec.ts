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

  test("get started sends a signed-out visitor to login, holding onboarding as the destination", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /get started/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveURL(/next=%2Fonboarding/);
  });
});

test.describe("no horizontal overflow", () => {
  // A page that scrolls sideways on a phone is the most common mobile-first
  // regression, and it never shows up in unit tests.
  for (const path of ["/", "/login", "/onboarding", "/dashboard", "/upload", "/transactions", "/settings"]) {
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

  test("onboarding does not collect an API key from a signed-out visitor", async ({
    page,
  }) => {
    // The Groq key form was reachable signed out: you could paste a live
    // credential into a form with no account to attach it to, and the failure
    // blamed the key rather than the missing session.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel(/your groq api key/i)).toHaveCount(0);
  });

  test("login preserves the intended destination", async ({ page }) => {
    await page.goto("/upload");
    await expect(page).toHaveURL(/next=%2Fupload/);
  });
});

test.describe("sign-in options", () => {
  test("offers Google and Outlook alongside the email link", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /continue with outlook/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /send sign-in link/i }),
    ).toBeVisible();
  });

  test("explains an expired sign-in link", async ({ page }) => {
    await page.goto("/login?error=invalid_link");
    await expect(page.locator('p[role="alert"]')).toContainText(/expired|already used/i);
  });
});

test.describe("magic-link landing", () => {
  test("a code landing on the site root is forwarded to the callback", async ({
    page,
  }) => {
    // Supabase falls back to the project Site URL when a redirect target is not
    // allow-listed, and that fallback drops the path — so the link arrived as
    // `/?code=...` and the code was never exchanged. Landing anywhere that
    // silently discards the code is the failure being guarded against.
    await page.goto("/?code=not-a-real-code");

    await expect(page).not.toHaveURL(/^[^?]*\/\?code=/);
    await expect(page).toHaveURL(/\/login|\/auth\/callback|\/dashboard/);
  });

  test("a callback with no code says so rather than failing silently", async ({
    page,
  }) => {
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/login\?error=missing_code/);
    await expect(page.locator('p[role="alert"]')).toContainText(/incomplete/i);
  });

  test("a bad code lands back on login with an explanation", async ({ page }) => {
    await page.goto("/auth/callback?code=definitely-not-valid");
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.locator('p[role="alert"]')).toBeVisible();
  });
});

test.describe("upload API contract", () => {
  /*
   * The upload UI reads every response as JSON. When a route 500s, Next
   * returns an HTML error page, `response.json()` throws, and the flow reports
   * "could not reach the server" — which blames the network for a server-side
   * crash and gives no clue where to look.
   *
   * This caught exactly that: pdf.js references DOMMatrix at module scope, and
   * on a serverless host with no native canvas package the import threw and
   * took the whole route down before any of its own code ran. Unit tests could
   * not see it because it only reproduces in the deployed runtime.
   */
  test("POST answers with JSON even when it rejects the request", async ({
    request,
  }) => {
    const response = await request.post("/api/documents", {
      multipart: {
        file: {
          name: "probe.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4\n%%EOF"),
        },
        provider: "bkash",
      },
    });

    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.status()).toBeLessThan(500);

    const body = await response.json();
    expect(typeof body.status).toBe("string");
  });

  test("GET answers with JSON", async ({ request }) => {
    const response = await request.get("/api/documents");
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.status()).toBeLessThan(500);
  });

  test("refuses an unauthenticated upload", async ({ request }) => {
    const response = await request.post("/api/documents", {
      multipart: {
        file: {
          name: "probe.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4\n%%EOF"),
        },
        provider: "bkash",
      },
    });

    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.code).toBe("unauthorized");
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
