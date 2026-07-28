import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReconcileFailed } from "./reconcile-failed";
import { VerifiedResult } from "./verified-result";
import { PasswordPrompt } from "./password-prompt";
import { DuplicateNotice } from "./duplicate-notice";
import { passwordHintFor } from "./provider-meta";
import {
  sampleRows,
  verifiedReconcile,
  failedReconcile,
  suspectRowIndexes,
} from "./__fixtures__";

/**
 * The upload screens are where the app either keeps or breaks its central
 * promise: a statement whose rows do not add up must never look like a
 * successful import.
 *
 * Assertions go through the components' `data-testid` hooks rather than prose,
 * so copy can be reworded without the suite going red — and so a test cannot
 * accidentally pass by matching a substring of a sentence that says the
 * opposite ("Nothing has been added to your ledger" contains "added to your
 * ledger").
 */

describe("ReconcileFailed", () => {
  function renderFailed(props: Partial<React.ComponentProps<typeof ReconcileFailed>> = {}) {
    return render(
      <ReconcileFailed
        filename="bkash-march.pdf"
        reconcile={failedReconcile}
        rows={sampleRows}
        suspectRowIndexes={suspectRowIndexes}
        onDiscard={vi.fn()}
        onReviewRows={vi.fn()}
        {...props}
      />,
    );
  }

  it("announces itself as a problem, not a result", () => {
    renderFailed();

    const banner = screen.getByTestId("reconcile-failed-banner");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent(/add up/i);
  });

  it("never shows the verified banner", () => {
    // The safety story collapses if this screen can be mistaken for success.
    renderFailed();
    expect(screen.queryByTestId("verified-banner")).not.toBeInTheDocument();
  });

  it("says nothing reached the ledger", () => {
    renderFailed();
    expect(screen.getByTestId("reconcile-failed-banner")).toHaveTextContent(
      /nothing has been added/i,
    );
  });

  it("states the size of the discrepancy in taka", () => {
    // "Something is wrong" is not actionable; the amount is.
    renderFailed();
    const amount = screen.getByTestId("discrepancy-amount");
    expect(amount).toBeVisible();
    expect(amount.textContent).toMatch(/1,150/);
  });

  it("shows both sides of the comparison", () => {
    renderFailed();
    expect(screen.getByText(/rows add up to/i)).toBeVisible();
    expect(screen.getByText(/statement says/i)).toBeVisible();
  });

  it("points at the rows the reader was least sure about", () => {
    renderFailed();
    const suspects = screen.getByTestId("suspect-rows");
    expect(within(suspects).getByText(/rows look wrong/i)).toBeVisible();
  });

  it("omits the suspect section when the pipeline named none", () => {
    renderFailed({ suspectRowIndexes: [] });
    expect(screen.queryByTestId("suspect-rows")).not.toBeInTheDocument();
  });

  it("offers a way out rather than a dead end", async () => {
    const onDiscard = vi.fn();
    renderFailed({ onDiscard });

    await userEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("names the file, so a multi-upload session stays legible", () => {
    renderFailed();
    expect(screen.getByText("bkash-march.pdf")).toBeVisible();
  });
});

describe("VerifiedResult", () => {
  function renderVerified(
    props: Partial<React.ComponentProps<typeof VerifiedResult>> = {},
  ) {
    return render(
      <VerifiedResult
        filename="bkash-march.pdf"
        reconcile={verifiedReconcile}
        rows={sampleRows}
        periodStart={new Date("2026-03-01T00:00:00Z")}
        periodEnd={new Date("2026-03-31T00:00:00Z")}
        onViewTransactions={vi.fn()}
        onUploadAnother={vi.fn()}
        {...props}
      />,
    );
  }

  it("explains what verified actually means", () => {
    // Not just a tick: the claim is that the rows sum to the statement's own
    // declared closing balance.
    renderVerified();
    const banner = screen.getByTestId("verified-banner");
    expect(banner).toHaveTextContent(/closing balance/i);
    expect(banner).toHaveTextContent(/nothing is missing/i);
  });

  it("reports how many transactions were imported", () => {
    renderVerified();
    expect(
      screen.getByRole("heading", {
        name: new RegExp(`${verifiedReconcile.rowCount} transactions? imported`, "i"),
      }),
    ).toBeVisible();
  });

  it("never shows the failure banner", () => {
    renderVerified();
    expect(screen.queryByTestId("reconcile-failed-banner")).not.toBeInTheDocument();
  });

  it("leads on to the transactions", async () => {
    const onViewTransactions = vi.fn();
    renderVerified({ onViewTransactions });

    await userEvent.click(
      screen.getByRole("button", { name: /see my transactions/i }),
    );
    expect(onViewTransactions).toHaveBeenCalledOnce();
  });

  it("offers another upload without leaving the screen", async () => {
    const onUploadAnother = vi.fn();
    renderVerified({ onUploadAnother });

    await userEvent.click(
      screen.getByRole("button", { name: /upload another/i }),
    );
    expect(onUploadAnother).toHaveBeenCalledOnce();
  });
});

describe("PasswordPrompt", () => {
  function renderPrompt(
    props: Partial<React.ComponentProps<typeof PasswordPrompt>> = {},
  ) {
    return render(
      <PasswordPrompt
        filename="bkash.pdf"
        provider="bkash"
        value=""
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        {...props}
      />,
    );
  }

  it("gives a provider-specific hint", () => {
    // The hint is the difference between one attempt and giving up — a bKash
    // statement password is the account mobile number, a bank's is not.
    renderPrompt({ provider: "bkash" });
    expect(screen.getByTestId("password-hint")).toHaveTextContent(
      passwordHintFor("bkash"),
    );
  });

  it("gives a different hint for a bank statement", () => {
    renderPrompt({ provider: "bank" });
    expect(screen.getByTestId("password-hint")).toHaveTextContent(
      passwordHintFor("bank"),
    );
    expect(passwordHintFor("bank")).not.toBe(passwordHintFor("bkash"));
  });

  it("masks the password by default", () => {
    renderPrompt({ value: "01712345678" });
    expect(screen.getByLabelText(/statement password/i)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("can reveal the password, since these are long numbers to type", async () => {
    renderPrompt({ value: "01712345678" });

    await userEvent.click(screen.getByRole("button", { name: /show|reveal/i }));
    expect(screen.getByLabelText(/statement password/i)).toHaveAttribute(
      "type",
      "text",
    );
  });

  it("keeps the user on the password screen after a wrong attempt", () => {
    // Re-prompting beats dumping them back to file selection.
    renderPrompt({ value: "0171", error: "That password did not work.", attempt: 2 });

    expect(screen.getByTestId("password-error")).toHaveTextContent(/did not work/i);
    expect(screen.getByLabelText(/statement password/i)).toBeVisible();
  });

  it("marks the field invalid for assistive tech on error", () => {
    renderPrompt({ error: "That password did not work." });
    expect(screen.getByLabelText(/statement password/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("reports what the user types", async () => {
    const onValueChange = vi.fn();
    renderPrompt({ onValueChange });

    await userEvent.type(screen.getByLabelText(/statement password/i), "0");
    expect(onValueChange).toHaveBeenCalled();
  });
});

describe("DuplicateNotice", () => {
  function renderDuplicate() {
    return render(
      <DuplicateNotice
        filename="bkash-march.pdf"
        uploadedAt={new Date("2026-03-20T06:00:00Z")}
        documentHref="/transactions?document=abc"
        rowCount={12}
        onUploadAnother={vi.fn()}
      />,
    );
  }

  it("says the statement was already imported, and when", () => {
    renderDuplicate();
    const message = screen.getByTestId("duplicate-message");
    expect(message).toHaveTextContent(/already uploaded/i);
    expect(message).toHaveTextContent(/2026/);
  });

  it("links to the import the user already has", () => {
    renderDuplicate();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/transactions?document=abc",
    );
  });

  it("names the file", () => {
    renderDuplicate();
    expect(screen.getByText("bkash-march.pdf")).toBeVisible();
  });
});
