import { describe, expect, it } from "vitest";

import {
  DocumentSchema,
  TransactionSchema,
  CATEGORIES,
  CURRENCIES,
  DIRECTIONS,
  PROVIDERS,
  RECONCILE_STATUSES,
  SOURCE_KINDS,
} from "@/lib/core/types";

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
} from "./mappers";
import type {
  DocumentRow,
  NewTransaction,
  TransactionRow,
  UserSettingsRow,
} from "./types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "22222222-2222-4222-8222-222222222222";
const TXN_ID = "33333333-3333-4333-8333-333333333333";
const PAIR_ID = "44444444-4444-4444-8444-444444444444";

function transactionRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: TXN_ID,
    user_id: USER_ID,
    document_id: DOC_ID,
    occurred_at: new Date("2026-02-05T04:30:00.000Z"),
    amount_minor: 123456,
    direction: "debit",
    currency: "BDT",
    ref_id: "9K2L4M6N",
    counterparty: "Shwapno Dhanmondi",
    description: "Payment to Shwapno",
    provider: "bkash",
    account_ref: "****4471",
    fee_minor: 185,
    balance_after_minor: 5_000_00,
    category: "food",
    raw_text: "05/02/2026 Payment 1,234.56 9K2L4M6N",
    transfer_pair_id: null,
    created_at: new Date("2026-02-06T09:00:00.000Z"),
    ...overrides,
  };
}

function documentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: DOC_ID,
    user_id: USER_ID,
    filename: "bkash-jan-2026.pdf",
    file_hash: "a".repeat(64),
    source_kind: "statement_pdf",
    provider: "bkash",
    period_start: new Date("2026-01-01T00:00:00.000Z"),
    period_end: new Date("2026-01-31T23:59:59.000Z"),
    opening_balance_minor: 1_000_00,
    closing_balance_minor: 850_25,
    reconcile_status: "verified",
    reconcile_delta_minor: 0,
    row_count: 42,
    created_at: new Date("2026-02-01T10:00:00.000Z"),
    ...overrides,
  };
}

function settingsRow(overrides: Partial<UserSettingsRow> = {}): UserSettingsRow {
  return {
    user_id: USER_ID,
    groq_api_key_encrypted: "v1.aaa.bbb.ccc",
    groq_key_masked: "gsk_••••••••4f2a",
    groq_key_set_at: new Date("2026-02-01T10:00:00.000Z"),
    default_currency: "BDT",
    timezone: "Asia/Dhaka",
    monthly_budget_minor: 30_000_00,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-02-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("toTransaction", () => {
  it("maps every column to its camelCase field", () => {
    const row = transactionRow();
    expect(toTransaction(row)).toEqual({
      id: row.id,
      userId: row.user_id,
      documentId: row.document_id,
      occurredAt: row.occurred_at,
      amountMinor: row.amount_minor,
      direction: row.direction,
      currency: row.currency,
      refId: row.ref_id,
      counterparty: row.counterparty,
      description: row.description,
      provider: row.provider,
      accountRef: row.account_ref,
      feeMinor: row.fee_minor,
      balanceAfterMinor: row.balance_after_minor,
      category: row.category,
      rawText: row.raw_text,
      transferPairId: row.transfer_pair_id,
      createdAt: row.created_at,
    });
  });

  it("produces an object TransactionSchema accepts", () => {
    expect(() => TransactionSchema.parse(toTransaction(transactionRow()))).not.toThrow();
  });

  it("preserves nulls rather than coercing them to defaults", () => {
    const mapped = toTransaction(
      transactionRow({
        document_id: null,
        ref_id: null,
        counterparty: null,
        account_ref: null,
        balance_after_minor: null,
        category: null,
        transfer_pair_id: null,
      }),
    );

    expect(mapped.documentId).toBeNull();
    expect(mapped.refId).toBeNull();
    expect(mapped.counterparty).toBeNull();
    expect(mapped.accountRef).toBeNull();
    expect(mapped.balanceAfterMinor).toBeNull();
    expect(mapped.category).toBeNull();
    expect(mapped.transferPairId).toBeNull();
    expect(() => TransactionSchema.parse(mapped)).not.toThrow();
  });

  it("keeps money as integer minor units, never dividing by 100", () => {
    const mapped = toTransaction(
      transactionRow({ amount_minor: 123456, fee_minor: 185 }),
    );
    expect(mapped.amountMinor).toBe(123456);
    expect(mapped.feeMinor).toBe(185);
    expect(Number.isInteger(mapped.amountMinor)).toBe(true);
  });

  it("passes zero amounts and zero balances through as 0, not null", () => {
    const mapped = toTransaction(
      transactionRow({ amount_minor: 0, fee_minor: 0, balance_after_minor: 0 }),
    );
    expect(mapped.amountMinor).toBe(0);
    expect(mapped.feeMinor).toBe(0);
    expect(mapped.balanceAfterMinor).toBe(0);
  });

  it("passes a negative balance through (an overdrawn account is legal)", () => {
    expect(
      toTransaction(transactionRow({ balance_after_minor: -25_00 })).balanceAfterMinor,
    ).toBe(-2500);
  });

  it("round-trips through transactionToRow without drift", () => {
    const row = transactionRow();
    const domain = toTransaction(row);
    const backToRow = transactionToRow(domain);

    for (const column of TRANSACTION_INSERT_COLUMNS) {
      expect(backToRow[column]).toEqual(row[column]);
    }
  });
});

describe("toStatementDocument", () => {
  it("maps every column to its camelCase field", () => {
    const row = documentRow();
    expect(toStatementDocument(row)).toEqual({
      id: row.id,
      userId: row.user_id,
      filename: row.filename,
      fileHash: row.file_hash,
      sourceKind: row.source_kind,
      provider: row.provider,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      openingBalanceMinor: row.opening_balance_minor,
      closingBalanceMinor: row.closing_balance_minor,
      reconcileStatus: row.reconcile_status,
      reconcileDeltaMinor: row.reconcile_delta_minor,
      rowCount: row.row_count,
      createdAt: row.created_at,
    });
  });

  it("produces an object DocumentSchema accepts", () => {
    expect(() => DocumentSchema.parse(toStatementDocument(documentRow()))).not.toThrow();
  });

  it("keeps a negative reconcile delta signed", () => {
    expect(
      toStatementDocument(documentRow({ reconcile_delta_minor: -1250 }))
        .reconcileDeltaMinor,
    ).toBe(-1250);
  });

  it("handles a document with no period or balances (an SMS batch)", () => {
    const mapped = toStatementDocument(
      documentRow({
        period_start: null,
        period_end: null,
        opening_balance_minor: null,
        closing_balance_minor: null,
        reconcile_status: "not_applicable",
        reconcile_delta_minor: null,
        source_kind: "sms",
      }),
    );
    expect(mapped.periodStart).toBeNull();
    expect(mapped.reconcileStatus).toBe("not_applicable");
    expect(() => DocumentSchema.parse(mapped)).not.toThrow();
  });
});

describe("toUserSettings", () => {
  it("never exposes the encrypted key", () => {
    const mapped = toUserSettings(settingsRow());
    expect(JSON.stringify(mapped)).not.toContain("v1.aaa.bbb.ccc");
    expect(Object.keys(mapped)).not.toContain("groqApiKeyEncrypted");
    expect(Object.keys(mapped)).not.toContain("groq_api_key_encrypted");
  });

  it("reports hasGroqKey from the presence of the ciphertext", () => {
    expect(toUserSettings(settingsRow()).hasGroqKey).toBe(true);
    expect(
      toUserSettings(settingsRow({ groq_api_key_encrypted: null })).hasGroqKey,
    ).toBe(false);
  });

  it("keeps the masked value, which is safe to display", () => {
    expect(toUserSettings(settingsRow()).groqKeyMasked).toBe("gsk_••••••••4f2a");
  });

  it("maps the remaining columns", () => {
    const mapped = toUserSettings(settingsRow());
    expect(mapped.userId).toBe(USER_ID);
    expect(mapped.defaultCurrency).toBe("BDT");
    expect(mapped.timezone).toBe("Asia/Dhaka");
    expect(mapped.monthlyBudgetMinor).toBe(3_000_000);
  });
});

describe("transactionToRow", () => {
  it("applies the same defaults as the zod schema", () => {
    const row = transactionToRow({
      userId: USER_ID,
      occurredAt: new Date("2026-03-01T00:00:00.000Z"),
      amountMinor: 5000,
      direction: "credit",
      description: "Salary",
      provider: "bank",
      rawText: "raw",
    });

    expect(row.currency).toBe("BDT");
    expect(row.fee_minor).toBe(0);
    expect(row.balance_after_minor).toBeNull();
    expect(row.category).toBeNull();
    expect(row.transfer_pair_id).toBeNull();
    expect(row.document_id).toBeNull();
    expect(row.ref_id).toBeNull();
    expect(row.counterparty).toBeNull();
    expect(row.account_ref).toBeNull();
  });

  it("emits exactly the columns the bulk insert names", () => {
    const row = transactionToRow({
      userId: USER_ID,
      occurredAt: new Date(),
      amountMinor: 1,
      direction: "debit",
      description: "d",
      provider: "manual",
      rawText: "r",
    });
    expect(Object.keys(row).sort()).toEqual([...TRANSACTION_INSERT_COLUMNS].sort());
  });

  it("does not turn an explicit 0 fee or 0 amount into a default", () => {
    const row = transactionToRow({
      userId: USER_ID,
      occurredAt: new Date(),
      amountMinor: 0,
      direction: "debit",
      description: "d",
      provider: "manual",
      rawText: "r",
      feeMinor: 0,
      balanceAfterMinor: 0,
    });
    expect(row.amount_minor).toBe(0);
    expect(row.fee_minor).toBe(0);
    expect(row.balance_after_minor).toBe(0);
  });
});

describe("documentToRow", () => {
  it("defaults reconcile status to pending and row count to 0", () => {
    const row = documentToRow({
      userId: USER_ID,
      filename: "x.pdf",
      fileHash: "b".repeat(64),
      sourceKind: "statement_pdf",
      provider: "bank",
    });
    expect(row.reconcile_status).toBe("pending");
    expect(row.row_count).toBe(0);
    expect(row.period_start).toBeNull();
    expect(row.opening_balance_minor).toBeNull();
  });

  it("emits exactly the columns the insert names", () => {
    const row = documentToRow({
      userId: USER_ID,
      filename: "x.pdf",
      fileHash: "b".repeat(64),
      sourceKind: "csv",
      provider: "bank",
    });
    expect(Object.keys(row).sort()).toEqual([...DOCUMENT_INSERT_COLUMNS].sort());
  });
});

describe("userSettingsPatchToRow", () => {
  it("returns nothing for an empty patch", () => {
    expect(userSettingsPatchToRow({})).toEqual({});
  });

  it("writes only the keys that are present", () => {
    expect(userSettingsPatchToRow({ timezone: "Asia/Dhaka" })).toEqual({
      timezone: "Asia/Dhaka",
    });
  });

  it("distinguishes an absent key from an explicit null", () => {
    // Absent: leave the stored key alone.
    expect(userSettingsPatchToRow({ timezone: "UTC" })).not.toHaveProperty(
      "groq_api_key_encrypted",
    );
    // Explicit null: clear it.
    expect(userSettingsPatchToRow({ groqApiKeyEncrypted: null })).toEqual({
      groq_api_key_encrypted: null,
    });
  });

  it("treats an explicit undefined as absent, not as a wipe", () => {
    expect(
      userSettingsPatchToRow({ groqApiKeyEncrypted: undefined, timezone: "UTC" }),
    ).toEqual({ timezone: "UTC" });
  });

  it("maps every supported field", () => {
    const setAt = new Date("2026-02-01T00:00:00.000Z");
    expect(
      userSettingsPatchToRow({
        defaultCurrency: "USD",
        timezone: "UTC",
        monthlyBudgetMinor: 100_00,
        groqApiKeyEncrypted: "v1.x.y.z",
        groqKeyMasked: "gsk_••••••••abcd",
        groqKeySetAt: setAt,
      }),
    ).toEqual({
      default_currency: "USD",
      timezone: "UTC",
      monthly_budget_minor: 10000,
      groq_api_key_encrypted: "v1.x.y.z",
      groq_key_masked: "gsk_••••••••abcd",
      groq_key_set_at: setAt,
    });
  });
});

describe("toMonthlyTotal", () => {
  it("computes net as credits minus debits minus fees", () => {
    expect(
      toMonthlyTotal({
        month: "2026-02",
        credit_minor: 50_000_00,
        debit_minor: 32_000_00,
        fee_minor: 250_00,
        transaction_count: 87,
      }),
    ).toEqual({
      month: "2026-02",
      creditMinor: 5_000_000,
      debitMinor: 3_200_000,
      feeMinor: 25_000,
      netMinor: 1_775_000,
      transactionCount: 87,
    });
  });

  it("returns a negative net when the month overspent", () => {
    const total = toMonthlyTotal({
      month: "2026-03",
      credit_minor: 1000,
      debit_minor: 4000,
      fee_minor: 100,
      transaction_count: 3,
    });
    expect(total.netMinor).toBe(-3100);
  });

  it("stays exact in integer arithmetic over large sums", () => {
    const total = toMonthlyTotal({
      month: "2026-04",
      credit_minor: 123_456_789,
      debit_minor: 987_654,
      fee_minor: 321,
      transaction_count: 1,
    });
    expect(total.netMinor).toBe(122_468_814);
    expect(Number.isInteger(total.netMinor)).toBe(true);
  });

  it("handles an empty month", () => {
    const total = toMonthlyTotal({
      month: "2026-05",
      credit_minor: 0,
      debit_minor: 0,
      fee_minor: 0,
      transaction_count: 0,
    });
    expect(total.netMinor).toBe(0);
  });
});

describe("toCategoryTotals", () => {
  it("computes each category's share of the total", () => {
    const result = toCategoryTotals([
      { category: "food", total_minor: 6000, transaction_count: 12 },
      { category: "transport", total_minor: 3000, transaction_count: 8 },
      { category: "bills", total_minor: 1000, transaction_count: 2 },
    ]);

    expect(result.map((r) => r.share)).toEqual([0.6, 0.3, 0.1]);
    expect(result.map((r) => r.category)).toEqual(["food", "transport", "bills"]);
  });

  it("shares sum to 1", () => {
    const result = toCategoryTotals([
      { category: "food", total_minor: 3333, transaction_count: 1 },
      { category: "health", total_minor: 3333, transaction_count: 1 },
      { category: "cash", total_minor: 3334, transaction_count: 1 },
    ]);
    const sum = result.reduce((acc, r) => acc + r.share, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("returns zero shares instead of NaN when the total is zero", () => {
    const result = toCategoryTotals([
      { category: "food", total_minor: 0, transaction_count: 0 },
    ]);
    expect(result[0].share).toBe(0);
    expect(Number.isNaN(result[0].share)).toBe(false);
  });

  it("keeps uncategorised rows as a null category", () => {
    const result = toCategoryTotals([
      { category: null, total_minor: 500, transaction_count: 3 },
    ]);
    expect(result[0].category).toBeNull();
    expect(result[0].share).toBe(1);
  });

  it("returns an empty array for no rows", () => {
    expect(toCategoryTotals([])).toEqual([]);
  });

  it("does not mutate the minor-unit totals", () => {
    const result = toCategoryTotals([
      { category: "shopping", total_minor: 123456, transaction_count: 4 },
    ]);
    expect(result[0].totalMinor).toBe(123456);
  });
});

describe("dedupeByRefKey", () => {
  const base = { userId: USER_ID, provider: "bkash" as const };

  it("keeps the first of two rows sharing a ref id", () => {
    const result = dedupeByRefKey([
      { ...base, refId: "TRX1", description: "first" },
      { ...base, refId: "TRX1", description: "second" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("first");
  });

  it("keeps every row with a null ref id", () => {
    const result = dedupeByRefKey([
      { ...base, refId: null },
      { ...base, refId: null },
      { ...base, refId: undefined },
    ]);
    expect(result).toHaveLength(3);
  });

  it("treats an empty-string ref id as absent", () => {
    expect(dedupeByRefKey([{ ...base, refId: "" }, { ...base, refId: "" }])).toHaveLength(2);
  });

  it("scopes the key by provider — the same id at two providers is two rows", () => {
    const result = dedupeByRefKey([
      { ...base, refId: "TRX1" },
      { userId: USER_ID, provider: "nagad" as const, refId: "TRX1" },
    ]);
    expect(result).toHaveLength(2);
  });

  it("scopes the key by user", () => {
    const result = dedupeByRefKey([
      { ...base, refId: "TRX1" },
      { userId: "99999999-9999-4999-8999-999999999999", provider: "bkash" as const, refId: "TRX1" },
    ]);
    expect(result).toHaveLength(2);
  });

  it("preserves input order", () => {
    const result = dedupeByRefKey([
      { ...base, refId: "A" },
      { ...base, refId: "B" },
      { ...base, refId: "A" },
      { ...base, refId: "C" },
    ]);
    expect(result.map((r) => r.refId)).toEqual(["A", "B", "C"]);
  });

  it("does not mutate the input", () => {
    const input = [{ ...base, refId: "A" }, { ...base, refId: "A" }];
    dedupeByRefKey(input);
    expect(input).toHaveLength(2);
  });

  it("handles an empty batch", () => {
    expect(dedupeByRefKey([])).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches with a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one batch when everything fits", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it("keeps every element exactly once", () => {
    const items = Array.from({ length: 1234 }, (_, i) => i);
    const batches = chunk(items, 500);
    expect(batches).toHaveLength(3);
    expect(batches.flat()).toEqual(items);
  });

  it("rejects a non-positive size rather than looping forever", () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
    expect(() => chunk([1], -1)).toThrow(RangeError);
  });
});

describe("schema/enum parity with core/types.ts", () => {
  // The migration hard-codes these enum members. If a union here grows, the
  // enum type in supabase/migrations must grow with it — this test is the
  // reminder, since a mismatch only shows up as a runtime insert failure.
  it("has the enum members the migration declares", () => {
    expect(PROVIDERS).toEqual([
      "bkash", "nagad", "rocket", "upay", "bank", "card", "manual",
    ]);
    expect(DIRECTIONS).toEqual(["credit", "debit"]);
    expect(SOURCE_KINDS).toEqual([
      "statement_pdf", "email", "sms", "csv", "manual",
    ]);
    expect(RECONCILE_STATUSES).toEqual([
      "verified", "failed", "not_applicable", "pending",
    ]);
    expect(CATEGORIES).toEqual([
      "food", "transport", "shopping", "bills", "health", "education",
      "entertainment", "salary", "transfer", "fees", "cash", "other",
    ]);
    expect(CURRENCIES).toEqual(["BDT", "USD", "EUR", "GBP", "INR"]);
  });

  it("maps a row for every provider and category the domain allows", () => {
    for (const provider of PROVIDERS) {
      for (const category of [...CATEGORIES, null]) {
        const input: NewTransaction = {
          userId: USER_ID,
          occurredAt: new Date("2026-02-05T04:30:00.000Z"),
          amountMinor: 100,
          direction: "debit",
          description: "d",
          provider,
          rawText: "r",
          category,
        };
        const row = transactionToRow(input);
        expect(row.provider).toBe(provider);
        expect(row.category).toBe(category);
      }
    }
  });

  it("round-trips a transfer leg with its pair id", () => {
    const mapped = toTransaction(
      transactionRow({ transfer_pair_id: PAIR_ID, category: "transfer" }),
    );
    expect(mapped.transferPairId).toBe(PAIR_ID);
    expect(transactionToRow(mapped).transfer_pair_id).toBe(PAIR_ID);
  });
});
