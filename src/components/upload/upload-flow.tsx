"use client";

import * as React from "react";
import type { Provider } from "@/lib/core/types";
import type { UploadResponse } from "./contract";
import { toDate, toExtractedRows } from "./contract";
import { DropZone } from "./drop-zone";
import { DuplicateNotice } from "./duplicate-notice";
import { PasswordPrompt } from "./password-prompt";
import {
  ProcessingProgress,
  PROCESSING_STAGES,
  type ProcessingStage,
} from "./processing-progress";
import { ReconcileFailed } from "./reconcile-failed";
import { UploadError } from "./upload-error";
import { VerifiedResult } from "./verified-result";

export interface UploadRequest {
  file: File;
  provider: Provider;
  password?: string;
  /** 1-based, so the server can report "attempt 3" back to the user. */
  attempt: number;
}

export type UploadFn = (request: UploadRequest) => Promise<UploadResponse>;

/** Default transport. Injectable so the flow can be tested without a server. */
export const postDocument: UploadFn = async ({
  file,
  provider,
  password,
  attempt,
}) => {
  const body = new FormData();
  body.append("file", file);
  body.append("provider", provider);
  body.append("attempt", String(attempt));
  if (password) body.append("password", password);

  let payload: unknown;
  try {
    const response = await fetch("/api/documents", { method: "POST", body });
    payload = await response.json();
  } catch {
    return {
      status: "error",
      code: "internal",
      message:
        "We could not reach the server. Check your connection and try again.",
    };
  }

  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { status?: unknown }).status === "string"
  ) {
    return payload as UploadResponse;
  }
  return {
    status: "error",
    code: "internal",
    message: "The server sent something we could not read. Please try again.",
  };
};

type FlowState =
  | { kind: "idle"; error: string | null }
  | { kind: "password"; error: string | null; attempt: number }
  | { kind: "processing"; stage: ProcessingStage; encrypted: boolean }
  | { kind: "verified"; response: Extract<UploadResponse, { status: "verified" }> }
  | {
      kind: "reconcile_failed";
      response: Extract<UploadResponse, { status: "reconcile_failed" }>;
    }
  | {
      kind: "duplicate";
      response: Extract<UploadResponse, { status: "duplicate" }>;
    }
  | { kind: "error"; response: Extract<UploadResponse, { status: "error" }> };

/**
 * Owns the upload state machine; every screen it renders is presentational.
 *
 * The chosen file lives in a ref for the whole run so a wrong password costs
 * one field, not the whole import. Nothing about the file — bytes or password —
 * is kept once a run finishes.
 */
export function UploadFlow({
  uploadFile = postDocument,
  onViewTransactions,
  documentHref = (id) => `/transactions?document=${id}`,
  initialProvider = "bkash",
  stageIntervalMs = 1500,
}: {
  uploadFile?: UploadFn;
  onViewTransactions?: () => void;
  documentHref?: (id: string) => string;
  initialProvider?: Provider;
  /** Cadence of the optimistic stage ticker. Large values freeze it in tests. */
  stageIntervalMs?: number;
}) {
  const [provider, setProvider] = React.useState<Provider>(initialProvider);
  const [password, setPassword] = React.useState("");
  const [state, setState] = React.useState<FlowState>({
    kind: "idle",
    error: null,
  });

  const fileRef = React.useRef<File | null>(null);
  const attemptRef = React.useRef(0);
  const filename = fileRef.current?.name ?? "";

  const reset = React.useCallback(() => {
    fileRef.current = null;
    attemptRef.current = 0;
    setPassword("");
    setState({ kind: "idle", error: null });
  }, []);

  const run = React.useCallback(
    async (secret?: string) => {
      const file = fileRef.current;
      if (!file) return;

      attemptRef.current += 1;
      setState({
        kind: "processing",
        // Only claim to decrypt when a password was actually supplied.
        encrypted: Boolean(secret),
        stage: secret ? "decrypting" : "reading",
      });

      const response = await uploadFile({
        file,
        provider,
        password: secret,
        attempt: attemptRef.current,
      });

      switch (response.status) {
        case "needs_password":
          setState({ kind: "password", error: null, attempt: 0 });
          return;
        case "wrong_password":
          setPassword("");
          setState({
            kind: "password",
            error:
              "That password didn’t unlock the file. Check it and try again.",
            attempt: response.attempt,
          });
          return;
        case "duplicate":
          setState({ kind: "duplicate", response });
          return;
        case "verified":
          setState({ kind: "verified", response });
          return;
        case "reconcile_failed":
          setState({ kind: "reconcile_failed", response });
          return;
        default:
          setState({ kind: "error", response });
      }
    },
    [provider, uploadFile],
  );

  // Optimistic stage ticker. The server answers once, so the labels advance on
  // a timer and stop at the last stage rather than pretending to finish.
  const isProcessing = state.kind === "processing";
  React.useEffect(() => {
    if (!isProcessing) return;
    const timer = setInterval(() => {
      setState((current) => {
        if (current.kind !== "processing") return current;
        const stages = PROCESSING_STAGES.filter(
          (item) => current.encrypted || item.id !== "decrypting",
        );
        const index = stages.findIndex((item) => item.id === current.stage);
        if (index === -1 || index >= stages.length - 1) return current;
        return { ...current, stage: stages[index + 1].id };
      });
    }, stageIntervalMs);
    return () => clearInterval(timer);
  }, [isProcessing, stageIntervalMs]);

  switch (state.kind) {
    case "processing":
      return (
        <ProcessingProgress
          filename={filename}
          stage={state.stage}
          encrypted={state.encrypted}
        />
      );

    case "password":
      return (
        <PasswordPrompt
          filename={filename}
          provider={provider}
          value={password}
          onValueChange={setPassword}
          onSubmit={() => void run(password)}
          onCancel={reset}
          error={state.error}
          attempt={state.attempt}
        />
      );

    case "duplicate":
      return (
        <DuplicateNotice
          filename={state.response.filename}
          uploadedAt={
            toDate(state.response.document.createdAt) ?? new Date(0)
          }
          rowCount={state.response.document.rowCount}
          periodStart={toDate(state.response.document.periodStart)}
          periodEnd={toDate(state.response.document.periodEnd)}
          documentHref={documentHref(state.response.document.id)}
          onUploadAnother={reset}
        />
      );

    case "verified":
      return (
        <VerifiedResult
          filename={state.response.document.filename}
          currency={state.response.document.currency}
          periodStart={toDate(state.response.document.periodStart)}
          periodEnd={toDate(state.response.document.periodEnd)}
          reconcile={state.response.reconcile}
          rows={toExtractedRows(state.response.rows)}
          onViewTransactions={
            onViewTransactions ??
            (() => {
              window.location.assign("/transactions");
            })
          }
          onUploadAnother={reset}
        />
      );

    case "reconcile_failed":
      return (
        <ReconcileFailed
          filename={state.response.document.filename}
          currency={state.response.document.currency}
          reconcile={state.response.reconcile}
          rows={toExtractedRows(state.response.rows)}
          suspectRowIndexes={state.response.suspectRowIndexes}
          onDiscard={reset}
        />
      );

    case "error":
      return (
        <UploadError
          code={state.response.code}
          message={state.response.message}
          onRetry={reset}
        />
      );

    default:
      return (
        <DropZone
          provider={provider}
          onProviderChange={setProvider}
          onFileSelected={(file) => {
            fileRef.current = file;
            attemptRef.current = 0;
            setPassword("");
            void run();
          }}
          error={state.error}
        />
      );
  }
}
