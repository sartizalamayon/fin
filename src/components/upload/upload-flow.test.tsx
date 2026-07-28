import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UploadFlow, type UploadFn } from "./upload-flow";
import {
  sampleDocument,
  failedDocument,
  duplicateDocument,
  sampleWireRows,
  verifiedReconcile,
  failedReconcile,
  suspectRowIndexes,
} from "./__fixtures__";

/**
 * The upload state machine.
 *
 * `uploadFile` is injectable, so the whole journey can be driven without a
 * server: choose a file, get asked for a password, get it wrong, get it right.
 * These assert the transitions, and above all that a failed reconciliation
 * cannot reach the success screen.
 */

function pdf(name = "bkash-march.pdf") {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: "application/pdf",
  });
}

async function choose(file = pdf()) {
  // The drop zone is a tap-to-pick file input on mobile.
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  await userEvent.upload(input!, file);
}

function renderFlow(uploadFile: UploadFn) {
  // A large stage interval freezes the optimistic progress ticker.
  return render(<UploadFlow uploadFile={uploadFile} stageIntervalMs={1_000_000} />);
}

describe("verified import", () => {
  it("goes from a chosen file to the verified screen", async () => {
    const uploadFile = vi.fn<UploadFn>().mockResolvedValue({
      status: "verified",
      document: sampleDocument,
      reconcile: verifiedReconcile,
      rows: sampleWireRows,
    });

    renderFlow(uploadFile);
    await choose();

    expect(await screen.findByTestId("verified-banner")).toBeVisible();
    expect(uploadFile).toHaveBeenCalledOnce();
  });

  it("sends the file and the chosen provider", async () => {
    const uploadFile = vi.fn<UploadFn>().mockResolvedValue({
      status: "verified",
      document: sampleDocument,
      reconcile: verifiedReconcile,
      rows: sampleWireRows,
    });

    renderFlow(uploadFile);
    await choose(pdf("statement.pdf"));

    await screen.findByTestId("verified-banner");
    const request = uploadFile.mock.calls[0][0];
    expect(request.file.name).toBe("statement.pdf");
    expect(request.provider).toBeTruthy();
    expect(request.attempt).toBe(1);
  });
});

describe("password handling", () => {
  it("asks for a password when the statement is encrypted", async () => {
    const uploadFile = vi.fn<UploadFn>().mockResolvedValue({
      status: "needs_password",
      filename: "bkash-march.pdf",
      provider: "bkash",
    });

    renderFlow(uploadFile);
    await choose();

    expect(await screen.findByLabelText(/statement password/i)).toBeVisible();
  });

  it("re-prompts on a wrong password instead of restarting", async () => {
    // Getting the password wrong must cost one field, not the whole import.
    const uploadFile = vi
      .fn<UploadFn>()
      .mockResolvedValueOnce({
        status: "needs_password",
        filename: "bkash-march.pdf",
        provider: "bkash",
      })
      .mockResolvedValueOnce({
        status: "wrong_password",
        filename: "bkash-march.pdf",
        provider: "bkash",
        attempt: 1,
      });

    renderFlow(uploadFile);
    await choose();

    const field = await screen.findByLabelText(/statement password/i);
    await userEvent.type(field, "01700000000");
    await userEvent.click(screen.getByRole("button", { name: /unlock|continue|submit/i }));

    expect(await screen.findByTestId("password-error")).toBeVisible();
    // Still on the password screen; the file was not thrown away.
    expect(screen.getByLabelText(/statement password/i)).toBeVisible();
  });

  it("reuses the same file on the retry, so it is picked once", async () => {
    const uploadFile = vi
      .fn<UploadFn>()
      .mockResolvedValueOnce({
        status: "needs_password",
        filename: "bkash-march.pdf",
        provider: "bkash",
      })
      .mockResolvedValueOnce({
        status: "verified",
        document: sampleDocument,
        reconcile: verifiedReconcile,
        rows: sampleWireRows,
      });

    renderFlow(uploadFile);
    await choose(pdf("only-once.pdf"));

    await userEvent.type(
      await screen.findByLabelText(/statement password/i),
      "01712345678",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /unlock|continue|submit/i }),
    );

    await screen.findByTestId("verified-banner");
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile.mock.calls[1][0].file.name).toBe("only-once.pdf");
    expect(uploadFile.mock.calls[1][0].password).toBe("01712345678");
    expect(uploadFile.mock.calls[1][0].attempt).toBe(2);
  });
});

describe("reconciliation failure", () => {
  it("shows the failure screen, never the verified one", async () => {
    // The single most important transition in this component.
    const uploadFile = vi.fn<UploadFn>().mockResolvedValue({
      status: "reconcile_failed",
      document: failedDocument,
      reconcile: failedReconcile,
      rows: sampleWireRows,
      suspectRowIndexes,
    });

    renderFlow(uploadFile);
    await choose();

    expect(await screen.findByTestId("reconcile-failed-banner")).toBeVisible();
    expect(screen.queryByTestId("verified-banner")).not.toBeInTheDocument();
  });

  it("offers a discard that returns the user to a usable state", async () => {
    const uploadFile = vi.fn<UploadFn>().mockResolvedValue({
      status: "reconcile_failed",
      document: failedDocument,
      reconcile: failedReconcile,
      rows: sampleWireRows,
      suspectRowIndexes,
    });

    renderFlow(uploadFile);
    await choose();

    await screen.findByTestId("reconcile-failed-banner");
    await userEvent.click(screen.getByRole("button", { name: /discard/i }));

    expect(
      screen.queryByTestId("reconcile-failed-banner"),
    ).not.toBeInTheDocument();
  });
});

describe("duplicates and errors", () => {
  it("says when the statement was already imported", async () => {
    const uploadFile = vi.fn<UploadFn>().mockResolvedValue({
      status: "duplicate",
      filename: "bkash-march.pdf",
      document: duplicateDocument,
    });

    renderFlow(uploadFile);
    await choose();

    expect(await screen.findByTestId("duplicate-message")).toHaveTextContent(
      /already uploaded/i,
    );
  });

  it("surfaces a missing Groq key as an actionable error", async () => {
    const uploadFile = vi.fn<UploadFn>().mockResolvedValue({
      status: "error",
      code: "no_key",
      message: "Add your Groq API key in Settings before uploading a statement.",
    });

    renderFlow(uploadFile);
    await choose();

    expect(await screen.findByText(/groq api key/i)).toBeVisible();
  });

  it("recovers from a thrown request rather than hanging", async () => {
    // A dropped connection must land on an error the user can act on. Asserting
    // only the absence of success would pass even if the flow spun forever.
    // The rejection is created lazily so it cannot leak as an unhandled one.
    const uploadFile = vi.fn<UploadFn>().mockImplementation(async () => {
      throw new Error("offline");
    });

    renderFlow(uploadFile);
    await choose();

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByTestId("verified-banner")).not.toBeInTheDocument();
  });
});
