/**
 * Database-layer types.
 *
 * Two vocabularies live here and must not be confused:
 *   * `*Row` types are what Postgres hands back — snake_case, exactly the
 *     column names in supabase/migrations/0001_init.sql.
 *   * The domain types (Transaction, StatementDocument) come from
 *     src/lib/core/types.ts — camelCase, and the only thing that ever leaves
 *     this module.
 *
 * src/lib/db/mappers.ts is the single crossing point between them.
 */

import type {
  Category,
  Currency,
  Direction,
  Provider,
  ReconcileStatus,
  SourceKind,
} from "@/lib/core/types";

// ---------------------------------------------------------------------------
// Raw row shapes (snake_case, as returned by Postgres)
// ---------------------------------------------------------------------------

export interface DocumentRow {
  id: string;
  user_id: string;
  filename: string;
  file_hash: string;
  source_kind: SourceKind;
  provider: Provider;
  period_start: Date | null;
  period_end: Date | null;
  opening_balance_minor: number | null;
  closing_balance_minor: number | null;
  reconcile_status: ReconcileStatus;
  reconcile_delta_minor: number | null;
  row_count: number;
  created_at: Date;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  document_id: string | null;
  occurred_at: Date;
  amount_minor: number;
  direction: Direction;
  currency: Currency;
  ref_id: string | null;
  counterparty: string | null;
  description: string;
  provider: Provider;
  account_ref: string | null;
  fee_minor: number;
  balance_after_minor: number | null;
  category: Category | null;
  raw_text: string;
  transfer_pair_id: string | null;
  created_at: Date;
}

export interface UserSettingsRow {
  user_id: string;
  /** AES-256-GCM envelope. Never crosses into the domain type — see mappers. */
  groq_api_key_encrypted: string | null;
  groq_key_masked: string | null;
  groq_key_set_at: Date | null;
  default_currency: Currency;
  timezone: string;
  monthly_budget_minor: number | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Insert inputs (camelCase; ids and timestamps are assigned by the database)
// ---------------------------------------------------------------------------

export interface NewDocument {
  userId: string;
  filename: string;
  /** SHA-256 hex of the uploaded bytes, 64 chars. */
  fileHash: string;
  sourceKind: SourceKind;
  provider: Provider;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  openingBalanceMinor?: number | null;
  closingBalanceMinor?: number | null;
  reconcileStatus?: ReconcileStatus;
  reconcileDeltaMinor?: number | null;
  rowCount?: number;
}

export interface NewTransaction {
  userId: string;
  documentId?: string | null;
  occurredAt: Date;
  /** Minor units, always non-negative. */
  amountMinor: number;
  direction: Direction;
  currency?: Currency;
  refId?: string | null;
  counterparty?: string | null;
  description: string;
  provider: Provider;
  accountRef?: string | null;
  feeMinor?: number;
  balanceAfterMinor?: number | null;
  category?: Category | null;
  rawText: string;
  transferPairId?: string | null;
}

// ---------------------------------------------------------------------------
// Query inputs / outputs
// ---------------------------------------------------------------------------

export interface DateRange {
  /** Inclusive lower bound on occurred_at. */
  from?: Date | null;
  /** Inclusive upper bound on occurred_at. */
  to?: Date | null;
}

export interface ListTransactionsOptions extends DateRange {
  userId: string;
  categories?: Category[];
  providers?: Provider[];
  direction?: Direction;
  documentId?: string;
  /** Case-insensitive substring match on description and counterparty. */
  search?: string;
  /** Defaults to 50, hard-capped at MAX_PAGE_SIZE. */
  limit?: number;
  offset?: number;
}

export interface TransactionPage {
  transactions: import("@/lib/core/types").Transaction[];
  /** Total matching rows, ignoring limit/offset. */
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface InsertTransactionsResult {
  inserted: import("@/lib/core/types").Transaction[];
  insertedCount: number;
  /** Rows rejected by the (user_id, provider, ref_id) dedup index. */
  skippedCount: number;
}

/** One month bucket, keyed the same way as monthKey() in core/dates.ts. */
export interface MonthlyTotal {
  /** `YYYY-MM` in Asia/Dhaka. */
  month: string;
  creditMinor: number;
  debitMinor: number;
  feeMinor: number;
  /** credits − debits − fees. Negative means a net outflow that month. */
  netMinor: number;
  transactionCount: number;
}

export interface CategoryTotal {
  /** Null means uncategorised. */
  category: Category | null;
  totalMinor: number;
  transactionCount: number;
  /** Fraction of the returned total, 0–1. Zero when the total is zero. */
  share: number;
}

export interface CategoryTotalsOptions extends DateRange {
  userId: string;
  /** Which side to total. Defaults to "debit" — the spend breakdown. */
  direction?: Direction;
  /** Drop own-account transfer legs, which net to zero. Defaults to false. */
  excludeTransfers?: boolean;
}

export interface MonthlyTotalsOptions extends DateRange {
  userId: string;
  /** Cap on how many of the most recent months to return. */
  limit?: number;
}

/**
 * User settings as seen by application code.
 *
 * Deliberately has no ciphertext field: the encrypted Groq key can never be
 * leaked through a settings object that gets serialised to the client. Use
 * getGroqApiKey() when the plaintext is actually needed server-side.
 */
export interface UserSettings {
  userId: string;
  hasGroqKey: boolean;
  /** Display-only, e.g. "gsk_••••••••4f2a". */
  groqKeyMasked: string | null;
  groqKeySetAt: Date | null;
  defaultCurrency: Currency;
  timezone: string;
  monthlyBudgetMinor: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSettingsPatch {
  defaultCurrency?: Currency;
  timezone?: string;
  monthlyBudgetMinor?: number | null;
  /** Set by the settings route only; produced by encryptSecret(). */
  groqApiKeyEncrypted?: string | null;
  groqKeyMasked?: string | null;
  groqKeySetAt?: Date | null;
}
