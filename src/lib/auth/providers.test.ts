import { describe, it, expect } from "vitest";

import {
  enabledOAuthProviders,
  describeAuthError,
  OAUTH_PROVIDERS,
} from "./providers";

describe("enabledOAuthProviders", () => {
  it("offers Google and Outlook by default", () => {
    expect(enabledOAuthProviders(undefined).map((p) => p.id)).toEqual([
      "google",
      "azure",
    ]);
  });

  it("honours an explicit list and its order", () => {
    expect(enabledOAuthProviders("azure,google").map((p) => p.id)).toEqual([
      "azure",
      "google",
    ]);
  });

  it("returns none when explicitly emptied", () => {
    // Lets a deployment without OAuth credentials hide the buttons entirely
    // rather than showing ones that error.
    expect(enabledOAuthProviders("")).toEqual([]);
    expect(enabledOAuthProviders("   ")).toEqual([]);
  });

  it("ignores unknown providers rather than rendering a dead button", () => {
    expect(enabledOAuthProviders("google,facebook").map((p) => p.id)).toEqual([
      "google",
    ]);
  });

  it("tolerates whitespace, casing and duplicates", () => {
    expect(enabledOAuthProviders(" GOOGLE , google ,azure").map((p) => p.id)).toEqual(
      ["google", "azure"],
    );
  });

  it("labels azure as Outlook, which is the word people recognise", () => {
    expect(OAUTH_PROVIDERS.azure.label).toBe("Outlook");
    expect(OAUTH_PROVIDERS.azure.id).toBe("azure");
  });

  it("asks azure for the email scope explicitly", () => {
    // Microsoft does not return an email address without it, and Supabase
    // cannot create an account with no email.
    expect(OAUTH_PROVIDERS.azure.scopes).toContain("email");
  });
});

describe("describeAuthError", () => {
  it("turns a disabled provider into an instruction", () => {
    const message = describeAuthError("Unsupported provider: not enabled", "Google");
    expect(message).toContain("Google");
    expect(message).toMatch(/email link/i);
    expect(message).not.toMatch(/unsupported provider/i);
  });

  it("explains a rate limit in plain terms", () => {
    expect(describeAuthError("Email rate limit exceeded")).toMatch(/wait/i);
  });

  it("flags a malformed email address", () => {
    expect(describeAuthError("Invalid email address")).toMatch(/email/i);
  });

  it("passes through an unrecognised message rather than swallowing it", () => {
    expect(describeAuthError("Server is on fire")).toBe("Server is on fire");
  });

  it("falls back to something readable when there is no message", () => {
    expect(describeAuthError(null)).toMatch(/went wrong/i);
    expect(describeAuthError("")).toMatch(/went wrong/i);
  });
});
