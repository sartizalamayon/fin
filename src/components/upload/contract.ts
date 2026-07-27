/**
 * Wire contract between the upload UI and `/api/documents`.
 *
 * Lives next to the UI because the UI is the only consumer that has to be
 * defensive about it — the route imports these types back so the two sides
 * cannot drift. Everything here is types plus tiny pure converters; nothing
 * imported here pulls server code into the client bundle.
 */

import type {
  Currency,
  ExtractedRow,
  Provider,
  ReconcileResult,
  ReconcileStatus,
} from "@/lib/core/types";

/** JSON has no Date. Every instant crosses the wire as ISO-8601. */
export type Iso = string;

export type WireExtractedRow = Omit<ExtractedRow, "occurredAt"> & {
  occurredAt: Iso;
};

export interface WireDocument {
  id: string;
  filename: string;
  provider: Provider;
  currency: Currency;
  periodStart: Iso | null;
  periodEnd: Iso | null;
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  reconcileStatus: ReconcileStatus;
  reconcileDeltaMinor: number | null;
  rowCount: number;
  createdAt: Iso;
}

export type UploadErrorCode =
  | "no_file"
  | "not_pdf"
  | "too_large"
  | "no_key"
  | "unauthorized"
  | "extract_failed"
  | "internal";

/**
 * Discriminated on `status` so the client can never accidentally treat an
 * unverified import as a successful one — there is no shared "ok" flag to
 * misread, and `reconcile_failed` carries no path into the ledger.
 */
export type UploadResponse =
  | {
      status: "needs_password";
      filename: string;
      provider: Provider | null;
    }
  | {
      status: "wrong_password";
      filename: string;
      provider: Provider | null;
      /** 1-based count of password attempts made so far. */
      attempt: number;
    }
  | {
      status: "duplicate";
      filename: string;
      document: WireDocument;
    }
  | {
      status: "verified";
      document: WireDocument;
      reconcile: ReconcileResult;
      rows: WireExtractedRow[];
    }
  | {
      status: "reconcile_failed";
      /**
       * Describes the import that was *not* saved. Nothing was written to the
       * ledger, so this id is a client key, not a database row.
       */
      document: WireDocument;
      reconcile: ReconcileResult;
      rows: WireExtractedRow[];
      /** Indexes into `rows` the pipeline flagged as most likely wrong. */
      suspectRowIndexes: number[];
    }
  | {
      status: "error";
      code: UploadErrorCode;
      message: string;
    };

export interface DocumentListResponse {
  documents: WireDocument[];
}

export interface DocumentDetailResponse {
  document: WireDocument;
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

export function toDate(value: Iso | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toExtractedRow(row: WireExtractedRow): ExtractedRow {
  return { ...row, occurredAt: new Date(row.occurredAt) };
}

export function toExtractedRows(rows: WireExtractedRow[]): ExtractedRow[] {
  return rows.map(toExtractedRow);
}
