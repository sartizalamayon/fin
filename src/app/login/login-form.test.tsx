import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoginForm } from "./login-form";

/**
 * The sign-in surface is the one screen every user meets, and the one place a
 * mistake locks them out entirely. These cover the paths a person actually
 * takes, plus the failure each one can hit.
 */

const { searchParams, signInWithOtp, signInWithOAuth } = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOtp, signInWithOAuth } }),
}));

beforeEach(() => {
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  signInWithOAuth.mockReset().mockResolvedValue({ error: null });
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});
// jsdom already supplies window.location.origin; replacing `window` wholesale
// detaches the document and every render fails with an opaque type error.

describe("provider buttons", () => {
  it("offers Google and Outlook", () => {
    render(<LoginForm />);
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /continue with outlook/i }),
    ).toBeVisible();
  });

  it("starts the Google flow with a callback that returns to the app", async () => {
    render(<LoginForm />);
    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({
          redirectTo: expect.stringContaining("/auth/callback"),
        }),
      }),
    );
  });

  it("uses the azure provider id behind the Outlook label", () => {
    render(<LoginForm />);
    expect(
      screen.getByRole("button", { name: /continue with outlook/i }),
    ).toBeVisible();
  });

  it("carries the intended destination through OAuth", async () => {
    searchParams.set("next", "/upload");
    render(<LoginForm />);

    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    const call = signInWithOAuth.mock.calls[0][0];
    expect(call.options.redirectTo).toContain(encodeURIComponent("/upload"));
  });

  it("refuses to carry an off-origin destination", async () => {
    // A forwarded sign-in link must not be able to bounce a freshly
    // authenticated user to another site.
    searchParams.set("next", "https://evil.test");
    render(<LoginForm />);

    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    const call = signInWithOAuth.mock.calls[0][0];
    expect(call.options.redirectTo).not.toContain("evil.test");
    expect(call.options.redirectTo).toContain(encodeURIComponent("/dashboard"));
  });

  it("explains a provider that is not switched on", async () => {
    signInWithOAuth.mockResolvedValue({
      error: { message: "Unsupported provider: provider is not enabled" },
    });
    render(<LoginForm />);

    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/google/i);
    expect(alert).toHaveTextContent(/email link/i);
  });
});

describe("email link", () => {
  it("requires an email before the button becomes usable", () => {
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: /send sign-in link/i })).toBeDisabled();
  });

  it("sends a link and confirms where it went", async () => {
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText(/email/i), "ayo@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send sign-in link/i }));

    await waitFor(() => {
      expect(signInWithOtp).toHaveBeenCalledWith(
        expect.objectContaining({ email: "ayo@example.com" }),
      );
    });
    expect(await screen.findByText(/check your email/i)).toBeVisible();
    expect(screen.getByText("ayo@example.com")).toBeVisible();
  });

  it("points the link back at the callback route, not the site root", async () => {
    // Landing on `/` leaves the code unexchanged and the user signed out.
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText(/email/i), "ayo@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send sign-in link/i }));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    const call = signInWithOtp.mock.calls[0][0];
    expect(call.options.emailRedirectTo).toContain("/auth/callback");
  });

  it("lets the user correct a mistyped address", async () => {
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText(/email/i), "typo@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send sign-in link/i }));

    await userEvent.click(
      await screen.findByRole("button", { name: /use a different email/i }),
    );
    expect(screen.getByLabelText(/email/i)).toHaveValue("");
  });

  it("surfaces a send failure instead of pretending it worked", async () => {
    signInWithOtp.mockResolvedValue({
      error: { message: "Email rate limit exceeded" },
    });
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText(/email/i), "ayo@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send sign-in link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/wait/i);
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
  });
});

describe("errors handed back by the callback route", () => {
  it("explains an expired link", () => {
    searchParams.set("error", "invalid_link");
    render(<LoginForm />);

    expect(screen.getByRole("alert")).toHaveTextContent(/expired|already been used|already used/i);
  });

  it("explains an incomplete link", () => {
    searchParams.set("error", "missing_code");
    render(<LoginForm />);

    expect(screen.getByRole("alert")).toHaveTextContent(/incomplete/i);
  });
});
