import { describe, it, expect } from "vitest";

import {
  PROTECTED_PREFIXES,
  isProtectedRoute,
  loginRedirectPath,
  safeNextPath,
} from "./routes";

describe("isProtectedRoute", () => {
  it.each(["/dashboard", "/upload", "/transactions", "/settings"])(
    "gates %s",
    (path) => {
      expect(isProtectedRoute(path)).toBe(true);
    },
  );

  it("gates /onboarding", () => {
    // Onboarding collects the user's Groq API key. Leaving it open lets someone
    // paste a live credential into a form that cannot possibly store it, and
    // the resulting error blames the key rather than the missing session.
    expect(isProtectedRoute("/onboarding")).toBe(true);
  });

  it("gates nested routes under a protected prefix", () => {
    expect(isProtectedRoute("/transactions/abc-123")).toBe(true);
    expect(isProtectedRoute("/settings/profile")).toBe(true);
  });

  it.each(["/", "/login", "/auth/callback"])("leaves %s public", (path) => {
    expect(isProtectedRoute(path)).toBe(false);
  });

  it("does not gate a sibling route that merely shares a prefix", () => {
    // A plain startsWith would gate these by accident.
    expect(isProtectedRoute("/settings-export")).toBe(false);
    expect(isProtectedRoute("/uploads")).toBe(false);
    expect(isProtectedRoute("/dashboards")).toBe(false);
  });

  it("keeps every screen that can reach financial data on the list", () => {
    for (const prefix of ["/dashboard", "/upload", "/transactions", "/settings"]) {
      expect(PROTECTED_PREFIXES).toContain(prefix);
    }
  });
});

describe("loginRedirectPath", () => {
  it("preserves the intended destination", () => {
    expect(loginRedirectPath("/upload")).toBe("/login?next=%2Fupload");
  });

  it("preserves the query string too", () => {
    expect(loginRedirectPath("/transactions", "?category=food")).toBe(
      "/login?next=%2Ftransactions%3Fcategory%3Dfood",
    );
  });
});

describe("safeNextPath", () => {
  it("passes through an ordinary in-app path", () => {
    expect(safeNextPath("/upload")).toBe("/upload");
    expect(safeNextPath("/transactions?category=food")).toBe(
      "/transactions?category=food",
    );
  });

  it("falls back when absent or empty", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath("   ")).toBe("/dashboard");
  });

  describe("open-redirect guards", () => {
    // Sign-in links get forwarded and shortened, so `next` is attacker
    // controlled. Every one of these would send a freshly authenticated user
    // off-origin, with their session already established.
    it.each([
      "https://evil.test",
      "http://evil.test/steal",
      "//evil.test",
      "/\\evil.test",
      "/%2fevil.test",
      "/%5cevil.test",
      "javascript:alert(1)",
      "evil.test",
    ])("rejects %p", (candidate) => {
      expect(safeNextPath(candidate)).toBe("/dashboard");
    });
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("https://evil.test", "/login")).toBe("/login");
  });
});
