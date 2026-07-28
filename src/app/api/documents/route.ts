import { NextResponse } from "next/server";

import { parseStatementDate } from "@/lib/core/dates";
import type { ExtractedRow, Provider, StatementDocument } from "@/lib/core/types";
import { hashFile } from "@/lib/dedupe/hash";
import { dedupeRows, keptRows } from "@/lib/dedupe";
import {
  ensureProfile,
  getDocumentByHash,
  getGroqApiKey,
  insertDocument,
  insertTransactions,
  listDocuments,
  listTransactions,
} from "@/lib/db/queries";
import {
  extractStatement,
  GroqLlmProvider,
  PasswordRequiredError,
  WrongPasswordError,
  isExtractionError,
} from "@/lib/extract";
import { getCurrentUser } from "@/lib/supabase/server";
import type {
  UploadResponse,
  WireDocument,
  WireExtractedRow,
} from "@/components/upload/contract";

/**
 * Statement upload.
 *
 * SECURITY: the uploaded PDF is never written to disk and never stored. Bytes
 * live in memory for the duration of this request and are dropped when it ends;
 * only extracted rows and their verbatim source text are persisted. The
 * statement password is likewise used once and never stored.
 *
 * A statement whose rows do not reconcile against its own closing balance is
 * NOT written to the ledger. It comes back as `reconcile_failed` for the user
 * to review. Wrong financial data is worse than missing financial data.
 */

export const runtime = "nodejs";
// 60s is the ceiling on Vercel's Hobby plan and is ample: decryption is
// instant and Groq answers in seconds even when a long statement is chunked.
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const documents = await listDocuments(user.id);
  return NextResponse.json({ documents: documents.map(toWireDocument) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return json({
      status: "error",
      code: "unauthorized",
      message: "Sign in to upload a statement.",
    });
  }

  // --- read the upload ----------------------------------------------------
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({
      status: "error",
      code: "no_file",
      message: "No file was received.",
    });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({
      status: "error",
      code: "no_file",
      message: "Choose a statement PDF to upload.",
    });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return json({
      status: "error",
      code: "too_large",
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 15 MB.`,
    });
  }

  const password = readString(form.get("password"));
  const provider = (readString(form.get("provider")) ?? "bank") as Provider;
  const attempt = Number(readString(form.get("attempt")) ?? "1") || 1;

  const bytes = new Uint8Array(await file.arrayBuffer());

  // --- cheapest check first: have we already imported these exact bytes? ---
  const fileHash = hashFile(bytes);
  const existing = await getDocumentByHash(user.id, fileHash);
  if (existing) {
    return json({
      status: "duplicate",
      filename: file.name,
      document: toWireDocument(existing),
    });
  }

  // --- the user's own Groq key -------------------------------------------
  // getGroqApiKey decrypts internally and hands back plaintext. It is used to
  // construct the client below and nothing else — never logged, never returned.
  let apiKey: string | null;
  try {
    apiKey = await getGroqApiKey(user.id);
  } catch {
    return json({
      status: "error",
      code: "no_key",
      message:
        "Your stored Groq key could not be decrypted. Re-enter it in Settings.",
    });
  }

  if (!apiKey) {
    return json({
      status: "error",
      code: "no_key",
      message:
        "Add your Groq API key in Settings before uploading a statement.",
    });
  }

  let llm: GroqLlmProvider;
  try {
    llm = new GroqLlmProvider(apiKey);
  } catch {
    return json({
      status: "error",
      code: "no_key",
      message:
        "Your stored Groq key could not be read. Re-enter it in Settings.",
    });
  }

  // --- extract and prove --------------------------------------------------
  try {
    const result = await extractStatement({
      bytes,
      password,
      llm,
      hint: { provider },
    });

    const { extraction, reconcile: proof, culprits } = result;
    const verified = proof.status === "verified" || proof.status === "not_applicable";

    if (!verified) {
      // Nothing is written. This document id is a client-side key only.
      return json({
        status: "reconcile_failed",
        document: unsavedWireDocument(file.name, fileHash, extraction, proof),
        reconcile: proof,
        rows: extraction.rows.map(toWireRow),
        suspectRowIndexes: culprits.map((c) => c.rowIndex),
      });
    }

    await ensureProfile(user.id, user.email);

    const document = await insertDocument({
      userId: user.id,
      filename: file.name,
      fileHash,
      sourceKind: "statement_pdf",
      provider: extraction.provider,
      periodStart: parseStatementDate(extraction.periodStart, result.dateOrder.order),
      periodEnd: parseStatementDate(extraction.periodEnd, result.dateOrder.order),
      openingBalanceMinor: extraction.openingBalanceMinor,
      closingBalanceMinor: extraction.closingBalanceMinor,
      reconcileStatus: proof.status,
      reconcileDeltaMinor: proof.deltaMinor,
      rowCount: extraction.rows.length,
    });

    // Dedupe against what this user already has before inserting. The unique
    // index on (user_id, provider, ref_id) is the backstop; this catches the
    // rows that carry no ref id, which the index cannot see.
    const priorPage = await listTransactions({
      userId: user.id,
      limit: 200,
      from: earliest(extraction.rows),
    });
    const decisions = dedupeRows(extraction.rows, priorPage.transactions);
    const fresh = keptRows(decisions);

    await insertTransactions(
      fresh.map((row) => ({
        userId: user.id,
        documentId: document.id,
        occurredAt: row.occurredAt,
        amountMinor: row.amountMinor,
        direction: row.direction,
        currency: row.currency,
        refId: row.refId,
        counterparty: row.counterparty,
        description: row.description,
        provider: row.provider,
        accountRef: row.accountRef,
        feeMinor: row.feeMinor,
        balanceAfterMinor: row.balanceAfterMinor,
        rawText: row.rawText,
      })),
    );

    return json({
      status: "verified",
      document: toWireDocument(document),
      reconcile: proof,
      rows: fresh.map(toWireRow),
    });
  } catch (err) {
    if (err instanceof PasswordRequiredError) {
      return json({ status: "needs_password", filename: file.name, provider });
    }
    if (err instanceof WrongPasswordError) {
      return json({
        status: "wrong_password",
        filename: file.name,
        provider,
        attempt,
      });
    }
    if (isExtractionError(err)) {
      return json({
        status: "error",
        code: "extract_failed",
        message: err.userMessage,
      });
    }

    console.error("[documents] unexpected failure", err);
    return json({
      status: "error",
      code: "internal",
      message: "Something went wrong reading that statement.",
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: UploadResponse) {
  return NextResponse.json(body);
}

function readString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function earliest(rows: readonly ExtractedRow[]): Date | undefined {
  if (rows.length === 0) return undefined;
  return rows.reduce(
    (min, row) => (row.occurredAt < min ? row.occurredAt : min),
    rows[0].occurredAt,
  );
}

function toWireRow(row: ExtractedRow): WireExtractedRow {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

function toWireDocument(doc: StatementDocument): WireDocument {
  return {
    id: doc.id,
    filename: doc.filename,
    provider: doc.provider,
    currency: "BDT",
    periodStart: doc.periodStart?.toISOString() ?? null,
    periodEnd: doc.periodEnd?.toISOString() ?? null,
    openingBalanceMinor: doc.openingBalanceMinor,
    closingBalanceMinor: doc.closingBalanceMinor,
    reconcileStatus: doc.reconcileStatus,
    reconcileDeltaMinor: doc.reconcileDeltaMinor,
    rowCount: doc.rowCount,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Describes an import that was rejected, so it has no database row. */
function unsavedWireDocument(
  filename: string,
  fileHash: string,
  extraction: { provider: Provider; currency: string; periodStart: string | null; periodEnd: string | null; openingBalanceMinor: number | null; closingBalanceMinor: number | null; rows: unknown[] },
  proof: { status: string; deltaMinor: number },
): WireDocument {
  return {
    id: `unsaved:${fileHash.slice(0, 16)}`,
    filename,
    provider: extraction.provider,
    currency: "BDT",
    periodStart: null,
    periodEnd: null,
    openingBalanceMinor: extraction.openingBalanceMinor,
    closingBalanceMinor: extraction.closingBalanceMinor,
    reconcileStatus: "failed",
    reconcileDeltaMinor: proof.deltaMinor,
    rowCount: extraction.rows.length,
    createdAt: new Date().toISOString(),
  };
}
