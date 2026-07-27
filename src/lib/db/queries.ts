/**
 * Typed query helpers.
 *
 * Contract for everything in this file:
 *   * Inputs and outputs are the camelCase domain types from
 *     src/lib/core/types.ts. Callers never see a snake_case column.
 *   * Every statement filters on user_id. RLS is the backstop (see
 *     0001_init.sql); an explicit predicate is the primary guard, because the
 *     pooled app role is not subject to RLS.
 *   * Money in and out is integer minor units, end to end.
 *
 * Server-only.
 */

import type postgres from "postgres";

import type { StatementDocument, Transaction } from "@/lib/core/types";
import { APP_TIMEZONE } from "@/lib/core/dates";
import { decryptSecret } from "@/lib/crypto/vault";

import { getSql, type AppSql } from "./client";
import {
  DOCUMENT_INSERT_COLUMNS,
  TRANSACTION_INSERT_COLUMNS,
  chunk,
  dedupeByRefKey,
  documentToRow,
  toCategoryTotals,
  toMonthlyTotal,
  toStatementDocument,
  toTransaction,
  toUserSettings,
  transactionToRow,
  userSettingsPatchToRow,
  type CategoryTotalRow,
  type MonthlyTotalRow,
  type SettingsColumnValue,
} from "./mappers";
import type {
  CategoryTotal,
  CategoryTotalsOptions,
  DocumentRow,
  InsertTransactionsResult,
  ListTransactionsOptions,
  MonthlyTotal,
  MonthlyTotalsOptions,
  NewDocument,
  NewTransaction,
  TransactionPage,
  TransactionRow,
  UserSettings,
  UserSettingsPatch,
  UserSettingsRow,
} from "./types";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Rows per INSERT. 16 columns × 500 = 8000 bind params, well under 65535. */
const INSERT_CHUNK_SIZE = 500;

/** Thrown when a file with this hash has already been ingested for this user. */
export class DuplicateDocumentError extends Error {
  readonly fileHash: string;
  readonly userId: string;

  constructor(userId: string, fileHash: string) {
    super(`Document with hash ${fileHash} already exists for this user`);
    this.name = "DuplicateDocumentError";
    this.userId = userId;
    this.fileHash = fileHash;
  }
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * Make sure a profiles row exists for this user.
 *
 * Every other table's user_id references profiles(id). On Supabase a trigger
 * creates the row at signup; locally (and for accounts that predate the
 * trigger) this fills the gap.
 */
export async function ensureProfile(
  userId: string,
  email?: string | null,
): Promise<void> {
  const sql = getSql();
  await sql`
    insert into profiles (id, email)
    values (${userId}, ${email ?? null})
    on conflict (id) do update
      set email = coalesce(excluded.email, profiles.email)
  `;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Insert an uploaded document.
 *
 * Throws DuplicateDocumentError if these exact bytes were already ingested —
 * the check that keeps a re-upload from costing an LLM call. Callers that
 * want to branch rather than catch should use getDocumentByHash() first.
 */
export async function insertDocument(
  input: NewDocument,
): Promise<StatementDocument> {
  const sql = getSql();
  const row = documentToRow(input);

  const rows = await sql<DocumentRow[]>`
    insert into documents ${sql(row, ...DOCUMENT_INSERT_COLUMNS)}
    on conflict (user_id, file_hash) do nothing
    returning *
  `;

  if (rows.length === 0) {
    throw new DuplicateDocumentError(input.userId, input.fileHash);
  }

  return toStatementDocument(rows[0]);
}

/** Look up a document by its SHA-256. Null when this user has not uploaded it. */
export async function getDocumentByHash(
  userId: string,
  fileHash: string,
): Promise<StatementDocument | null> {
  const sql = getSql();
  const rows = await sql<DocumentRow[]>`
    select * from documents
    where user_id = ${userId} and file_hash = ${fileHash}
    limit 1
  `;
  return rows.length > 0 ? toStatementDocument(rows[0]) : null;
}

export async function getDocumentById(
  userId: string,
  documentId: string,
): Promise<StatementDocument | null> {
  const sql = getSql();
  const rows = await sql<DocumentRow[]>`
    select * from documents
    where user_id = ${userId} and id = ${documentId}
    limit 1
  `;
  return rows.length > 0 ? toStatementDocument(rows[0]) : null;
}

export async function listDocuments(
  userId: string,
  limit = DEFAULT_PAGE_SIZE,
): Promise<StatementDocument[]> {
  const sql = getSql();
  const rows = await sql<DocumentRow[]>`
    select * from documents
    where user_id = ${userId}
    order by created_at desc
    limit ${clampLimit(limit)}
  `;
  return rows.map(toStatementDocument);
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * Bulk-insert extracted rows.
 *
 * Rows colliding with an existing (user_id, provider, ref_id) are skipped, not
 * updated: statement data already stored is at least as trustworthy as what we
 * are inserting, and silently overwriting would hide extraction regressions.
 *
 * The batch is deduped in memory first so `skippedCount` means "already in the
 * database", not "appeared twice in this array".
 */
export async function insertTransactions(
  rows: readonly NewTransaction[],
): Promise<InsertTransactionsResult> {
  if (rows.length === 0) {
    return { inserted: [], insertedCount: 0, skippedCount: 0 };
  }

  const sql = getSql();
  const deduped = dedupeByRefKey(rows);
  const inserted: Transaction[] = [];

  for (const batch of chunk(deduped, INSERT_CHUNK_SIZE)) {
    const payload = batch.map(transactionToRow);
    const result = await sql<TransactionRow[]>`
      insert into transactions ${sql(payload, ...TRANSACTION_INSERT_COLUMNS)}
      on conflict (user_id, provider, ref_id) where ref_id is not null
      do nothing
      returning *
    `;
    for (const row of result) inserted.push(toTransaction(row));
  }

  return {
    inserted,
    insertedCount: inserted.length,
    // Counted against the deduped batch: rows dropped in memory were never
    // candidates for insertion in the first place.
    skippedCount: deduped.length - inserted.length,
  };
}

/**
 * Paginated, filtered transaction list — the dashboard table and the CSV
 * export both come through here.
 *
 * Ordered by occurred_at desc with an id tiebreak, so two rows at the same
 * instant do not swap places between pages and get shown twice or never.
 */
export async function listTransactions(
  options: ListTransactionsOptions,
): Promise<TransactionPage> {
  const sql = getSql();
  const limit = clampLimit(options.limit ?? DEFAULT_PAGE_SIZE);
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const where = buildTransactionFilter(sql, options);

  const rows = await sql<TransactionRow[]>`
    select * from transactions
    where ${where}
    order by occurred_at desc, id desc
    limit ${limit} offset ${offset}
  `;

  const [{ total }] = await sql<{ total: number }[]>`
    select count(*)::bigint as total from transactions where ${where}
  `;

  return {
    transactions: rows.map(toTransaction),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
}

export async function getTransactionById(
  userId: string,
  transactionId: string,
): Promise<Transaction | null> {
  const sql = getSql();
  const rows = await sql<TransactionRow[]>`
    select * from transactions
    where user_id = ${userId} and id = ${transactionId}
    limit 1
  `;
  return rows.length > 0 ? toTransaction(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * Month-by-month credits, debits and fees.
 *
 * Bucketed in Asia/Dhaka, matching monthKey() in core/dates.ts — a UTC bucket
 * would file a 1 a.m. Dhaka transaction into the previous month.
 *
 * Returned oldest-first, which is the order a time-series chart wants.
 */
export async function getMonthlyTotals(
  options: MonthlyTotalsOptions,
): Promise<MonthlyTotal[]> {
  const sql = getSql();
  const where = buildTransactionFilter(sql, options);
  const limit = clampLimit(options.limit ?? 24, 120);

  const rows = await sql<MonthlyTotalRow[]>`
    select
      to_char(occurred_at at time zone ${APP_TIMEZONE}, 'YYYY-MM') as month,
      coalesce(sum(amount_minor) filter (where direction = 'credit'), 0)::bigint
        as credit_minor,
      coalesce(sum(amount_minor) filter (where direction = 'debit'), 0)::bigint
        as debit_minor,
      coalesce(sum(fee_minor), 0)::bigint as fee_minor,
      count(*)::bigint as transaction_count
    from transactions
    where ${where}
    group by 1
    order by 1 desc
    limit ${limit}
  `;

  return rows.map(toMonthlyTotal).reverse();
}

/**
 * Spend (or income) split by category, largest first.
 *
 * Defaults to debits: "where did the money go" is the question a dashboard
 * category chart answers. Uncategorised rows come back as `category: null`
 * rather than being dropped, so the chart's total still matches the ledger.
 */
export async function getCategoryTotals(
  options: CategoryTotalsOptions,
): Promise<CategoryTotal[]> {
  const sql = getSql();
  const direction = options.direction ?? "debit";

  const conditions: Fragment[] = [
    ...transactionConditions(sql, options),
    sql`direction = ${direction}`,
  ];
  if (options.excludeTransfers) {
    conditions.push(sql`transfer_pair_id is null`);
    conditions.push(sql`(category is null or category <> 'transfer')`);
  }
  const where = joinAnd(sql, conditions);

  const rows = await sql<CategoryTotalRow[]>`
    select
      category,
      coalesce(sum(amount_minor), 0)::bigint as total_minor,
      count(*)::bigint as transaction_count
    from transactions
    where ${where}
    group by category
    order by 2 desc
  `;

  return toCategoryTotals(rows);
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

/** Null when the user has never saved settings. Never carries the ciphertext. */
export async function getUserSettings(
  userId: string,
): Promise<UserSettings | null> {
  const sql = getSql();
  const rows = await sql<UserSettingsRow[]>`
    select * from user_settings where user_id = ${userId} limit 1
  `;
  return rows.length > 0 ? toUserSettings(rows[0]) : null;
}

/**
 * Create or update settings.
 *
 * Only the keys present on `patch` are written — passing `{ timezone }` leaves
 * the Groq key alone, and passing `{ groqApiKeyEncrypted: null }` explicitly
 * clears it. Requires a profiles row; call ensureProfile() first.
 */
export async function upsertUserSettings(
  userId: string,
  patch: UserSettingsPatch = {},
): Promise<UserSettings> {
  const sql = getSql();
  const patchRow = userSettingsPatchToRow(patch);
  const columns = Object.keys(patchRow);

  if (columns.length === 0) {
    // No changes: just guarantee the row exists.
    const rows = await sql<UserSettingsRow[]>`
      insert into user_settings (user_id) values (${userId})
      on conflict (user_id) do update set updated_at = now()
      returning *
    `;
    return toUserSettings(rows[0]);
  }

  const insertRow: Record<string, SettingsColumnValue> = {
    user_id: userId,
    ...patchRow,
  };
  const insertColumns = ["user_id", ...columns];

  const rows = await sql<UserSettingsRow[]>`
    insert into user_settings ${sql(insertRow, insertColumns)}
    on conflict (user_id) do update set ${sql(patchRow, columns)}
    returning *
  `;

  return toUserSettings(rows[0]);
}

/**
 * Decrypt and return the user's Groq key.
 *
 * The ONLY path from ciphertext to plaintext. Callers must use the result to
 * construct a Groq client and nothing else — never log it, never put it in a
 * response body. Returns null when no key is stored.
 */
export async function getGroqApiKey(userId: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql<{ groq_api_key_encrypted: string | null }[]>`
    select groq_api_key_encrypted from user_settings
    where user_id = ${userId} limit 1
  `;

  const ciphertext = rows[0]?.groq_api_key_encrypted;
  return ciphertext ? decryptSecret(ciphertext) : null;
}

/** Remove the stored Groq key. No-op when the user has no settings row. */
export async function clearGroqApiKey(userId: string): Promise<void> {
  const sql = getSql();
  await sql`
    update user_settings
    set groq_api_key_encrypted = null,
        groq_key_masked = null,
        groq_key_set_at = null
    where user_id = ${userId}
  `;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function clampLimit(limit: number, max = MAX_PAGE_SIZE): number {
  if (!Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.trunc(limit)), max);
}

/** A composable SQL fragment, as produced by a tagged-template call. */
type Fragment = postgres.PendingQuery<postgres.Row[]>;

/** AND a list of fragments. Never empty — user_id is always present. */
function joinAnd(sql: AppSql, fragments: Fragment[]): Fragment {
  return fragments.reduce((acc, fragment) => sql`${acc} and ${fragment}`);
}

/**
 * Shared predicate builder. `user_id` is always first and unconditional, so
 * there is no code path that can produce an unscoped transaction query.
 */
function transactionConditions(
  sql: AppSql,
  options: ListTransactionsOptions | CategoryTotalsOptions | MonthlyTotalsOptions,
): Fragment[] {
  const conditions: Fragment[] = [sql`user_id = ${options.userId}`];

  if (options.from) conditions.push(sql`occurred_at >= ${options.from}`);
  if (options.to) conditions.push(sql`occurred_at <= ${options.to}`);

  if ("categories" in options && options.categories?.length) {
    conditions.push(sql`category in ${sql(options.categories)}`);
  }
  if ("providers" in options && options.providers?.length) {
    conditions.push(sql`provider in ${sql(options.providers)}`);
  }
  if ("direction" in options && options.direction) {
    conditions.push(sql`direction = ${options.direction}`);
  }
  if ("documentId" in options && options.documentId) {
    conditions.push(sql`document_id = ${options.documentId}`);
  }
  if ("search" in options && options.search?.trim()) {
    // Escape LIKE metacharacters so a user searching for "100%" does not get
    // a wildcard scan of everything.
    const term = `%${escapeLike(options.search.trim())}%`;
    conditions.push(
      sql`(description ilike ${term} escape '\\' or counterparty ilike ${term} escape '\\')`,
    );
  }

  return conditions;
}

function buildTransactionFilter(
  sql: AppSql,
  options: ListTransactionsOptions | CategoryTotalsOptions | MonthlyTotalsOptions,
): Fragment {
  return joinAnd(sql, transactionConditions(sql, options));
}

export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}
