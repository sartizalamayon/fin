import { z } from "zod";

/**
 * Canonical domain contract. Every ingestion source — bKash statement, bank
 * e-statement, email alert, SMS — normalises into these shapes. Nothing
 * downstream (charts, budgets, dedup) knows which source a row came from.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PROVIDERS = [
  "bkash",
  "nagad",
  "rocket",
  "upay",
  "bank",
  "card",
  "manual",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const DIRECTIONS = ["credit", "debit"] as const;
/** `credit` = money in, `debit` = money out. Amounts are always positive. */
export type Direction = (typeof DIRECTIONS)[number];

export const SOURCE_KINDS = [
  "statement_pdf",
  "email",
  "sms",
  "csv",
  "manual",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Whether a document's extracted rows were proven correct against its own
 * declared balances. `not_applicable` covers sources with no balance to check
 * (email alerts, SMS) — those rows are provisional and lose to statement data.
 */
export const RECONCILE_STATUSES = [
  "verified",
  "failed",
  "not_applicable",
  "pending",
] as const;
export type ReconcileStatus = (typeof RECONCILE_STATUSES)[number];

export const CATEGORIES = [
  "food",
  "transport",
  "shopping",
  "bills",
  "health",
  "education",
  "entertainment",
  "salary",
  "transfer",
  "fees",
  "cash",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * All money is integer minor units (poisha for BDT, cents for USD). Never
 * floats — reconciliation sums thousands of rows and IEEE754 drift would
 * produce false mismatches that look like extraction bugs.
 */
export const MinorUnits = z
  .number()
  .int("money must be integer minor units (poisha), not a float");

export const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export const TransactionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  /** Null for rows that arrived outside a document (SMS, manual entry). */
  documentId: z.string().uuid().nullable(),

  occurredAt: z.coerce.date(),
  /** Always positive. Sign lives in `direction`, never in the amount. */
  amountMinor: MinorUnits.nonnegative(),
  direction: z.enum(DIRECTIONS),
  currency: z.enum(CURRENCIES).default("BDT"),

  /** Provider-issued transaction id (bKash TrxID etc). The strongest dedup key. */
  refId: z.string().nullable(),
  counterparty: z.string().nullable(),
  description: z.string(),

  provider: z.enum(PROVIDERS),
  /** Masked account/wallet identifier, e.g. "****4471". Never store in full. */
  accountRef: z.string().nullable(),

  /** Provider fee charged on top of the amount, as its own minor-unit value. */
  feeMinor: MinorUnits.nonnegative().default(0),
  /** Running balance after this row, when the source states one. */
  balanceAfterMinor: MinorUnits.nullable().default(null),

  category: z.enum(CATEGORIES).nullable().default(null),

  /**
   * Verbatim source text for this row. Kept so prompts can improve and rows be
   * re-parsed without re-uploading. We deliberately do NOT keep the source PDF.
   */
  rawText: z.string(),

  /** Set when this row is one leg of an own-account transfer; nets to zero. */
  transferPairId: z.string().uuid().nullable().default(null),

  createdAt: z.coerce.date(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

/** What an extractor produces, before persistence assigns ids. */
export const ExtractedRowSchema = TransactionSchema.omit({
  id: true,
  userId: true,
  documentId: true,
  category: true,
  transferPairId: true,
  createdAt: true,
});
export type ExtractedRow = z.infer<typeof ExtractedRowSchema>;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),

  filename: z.string(),
  /** SHA-256 of the uploaded bytes. Re-uploads are rejected before any LLM call. */
  fileHash: z.string().length(64),
  sourceKind: z.enum(SOURCE_KINDS),
  provider: z.enum(PROVIDERS),

  /** Statement period. Used to detect overlapping uploads (Jan–Mar then Feb–Apr). */
  periodStart: z.coerce.date().nullable(),
  periodEnd: z.coerce.date().nullable(),

  openingBalanceMinor: MinorUnits.nullable(),
  closingBalanceMinor: MinorUnits.nullable(),

  reconcileStatus: z.enum(RECONCILE_STATUSES).default("pending"),
  /** Signed minor-unit gap between computed and declared closing balance. */
  reconcileDeltaMinor: MinorUnits.nullable().default(null),

  rowCount: z.number().int().nonnegative().default(0),
  createdAt: z.coerce.date(),
});
export type StatementDocument = z.infer<typeof DocumentSchema>;

// ---------------------------------------------------------------------------
// Extraction pipeline
// ---------------------------------------------------------------------------

/** Raw text pulled out of a document, before the LLM sees it. */
export interface ExtractedText {
  text: string;
  pageCount: number;
  /** True when the PDF carried no text layer and OCR produced this. */
  viaOcr: boolean;
  wasEncrypted: boolean;
}

export const StatementExtractionSchema = z.object({
  provider: z.enum(PROVIDERS),
  accountRef: z.string().nullable(),
  currency: z.enum(CURRENCIES).default("BDT"),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  openingBalanceMinor: MinorUnits.nullable(),
  closingBalanceMinor: MinorUnits.nullable(),
  rows: z.array(ExtractedRowSchema),
});
export type StatementExtraction = z.infer<typeof StatementExtractionSchema>;

export interface ReconcileResult {
  status: ReconcileStatus;
  /** computed closing − declared closing, in minor units. Zero when verified. */
  deltaMinor: number;
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  computedClosingMinor: number | null;
  totalCreditsMinor: number;
  totalDebitsMinor: number;
  totalFeesMinor: number;
  rowCount: number;
  message: string;
}

/**
 * Pluggable LLM backend. Production uses Groq with the user's own key; tests
 * use a deterministic fixture provider so the suite needs no network or key.
 */
export interface LlmProvider {
  readonly name: string;
  extractStatement(input: {
    text: string;
    hint?: { provider?: Provider; bankName?: string };
  }): Promise<StatementExtraction>;
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

export const DUPLICATE_REASONS = [
  "file_hash",
  "ref_id",
  "fuzzy_match",
  "period_overlap",
] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

export interface DedupeDecision {
  row: ExtractedRow;
  isDuplicate: boolean;
  reason: DuplicateReason | null;
  /** Id of the already-stored transaction this row collides with. */
  existingId: string | null;
}

export interface TransferCandidate {
  outLegRefId: string;
  inLegRefId: string;
  amountMinor: number;
  confidence: number;
}
