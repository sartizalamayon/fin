import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { closeSql, getSql } from "./client";
import { encryptSecret, maskSecret } from "@/lib/crypto/vault";
import {
  ensureProfile,
  getDocumentByHash,
  insertDocument,
  insertTransactions,
  listDocuments,
  listTransactions,
  upsertUserSettings,
  getGroqApiKey,
} from "./queries";

/**
 * Isolation is the one property that cannot be verified by reading the code.
 *
 * `client.ts` connects as the owner role, which bypasses RLS — so the promise
 * that "every query filters on user_id" is enforced by discipline in
 * queries.ts, not by the database. Discipline is exactly the kind of thing that
 * decays silently, so this suite checks it against a live database: two users,
 * overlapping data, and the assertion that neither can ever observe the other.
 *
 * Requires a Postgres with migrations applied. Skipped when TEST_DATABASE_URL
 * is unset so the default unit run stays offline.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const alice = randomUUID();
const bob = randomUUID();

describeIfDb("database isolation", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    await ensureProfile(alice, `alice-${alice.slice(0, 8)}@example.test`);
    await ensureProfile(bob, `bob-${bob.slice(0, 8)}@example.test`);
  });

  afterAll(async () => {
    const sql = getSql();
    // Cascades clear documents, transactions and settings.
    await sql`delete from profiles where id in (${alice}, ${bob})`;
    await closeSql();
  });

  it("does not leak documents between users", async () => {
    const aliceDoc = await insertDocument({
      userId: alice,
      filename: "alice-statement.pdf",
      fileHash: "a".repeat(64),
      sourceKind: "statement_pdf",
      provider: "bkash",
      reconcileStatus: "verified",
      rowCount: 1,
    });

    await insertDocument({
      userId: bob,
      filename: "bob-statement.pdf",
      fileHash: "b".repeat(64),
      sourceKind: "statement_pdf",
      provider: "bank",
      reconcileStatus: "verified",
      rowCount: 1,
    });

    const aliceDocs = await listDocuments(alice);
    const bobDocs = await listDocuments(bob);

    expect(aliceDocs.map((d) => d.id)).toContain(aliceDoc.id);
    expect(bobDocs.map((d) => d.id)).not.toContain(aliceDoc.id);
    expect(bobDocs.every((d) => d.userId === bob)).toBe(true);
  });

  it("scopes the file-hash duplicate check per user", async () => {
    // Two users uploading the same statement bytes is not a duplicate — it is
    // two people with the same file. Scoping this wrongly would make one user's
    // upload silently vanish because a stranger uploaded it first.
    const sharedHash = "c".repeat(64);

    await insertDocument({
      userId: alice,
      filename: "shared.pdf",
      fileHash: sharedHash,
      sourceKind: "statement_pdf",
      provider: "bkash",
      reconcileStatus: "verified",
    });

    expect(await getDocumentByHash(alice, sharedHash)).not.toBeNull();
    expect(await getDocumentByHash(bob, sharedHash)).toBeNull();
  });

  it("does not leak transactions between users", async () => {
    await insertTransactions([
      {
        userId: alice,
        occurredAt: new Date("2026-03-05T06:00:00Z"),
        amountMinor: 123456,
        direction: "debit",
        description: "Alice grocery",
        provider: "bkash",
        rawText: "alice row",
      },
      {
        userId: bob,
        occurredAt: new Date("2026-03-05T06:00:00Z"),
        amountMinor: 999999,
        direction: "debit",
        description: "Bob rent",
        provider: "bank",
        rawText: "bob row",
      },
    ]);

    const alicePage = await listTransactions({ userId: alice });
    const bobPage = await listTransactions({ userId: bob });

    expect(alicePage.transactions.every((t) => t.userId === alice)).toBe(true);
    expect(bobPage.transactions.every((t) => t.userId === bob)).toBe(true);

    expect(
      alicePage.transactions.some((t) => t.description === "Bob rent"),
    ).toBe(false);
    expect(
      bobPage.transactions.some((t) => t.description === "Alice grocery"),
    ).toBe(false);
  });

  it("does not leak search results across users", async () => {
    // Search is the easiest place to forget the user filter, because the
    // interesting predicate is the text one.
    const page = await listTransactions({ userId: alice, search: "rent" });
    expect(page.transactions.every((t) => t.userId === alice)).toBe(true);
    expect(page.transactions.some((t) => t.description === "Bob rent")).toBe(false);
  });

  it("keeps each user's Groq key separate", async () => {
    // getGroqApiKey is the only path from ciphertext back to plaintext, so the
    // stored value must be a real envelope — round-tripping it here also proves
    // the vault and the query layer agree on the format.
    const aliceKey = "gsk_aliceKEY0000000000000000";
    const bobKey = "gsk_bobKEY00000000000000000";

    await upsertUserSettings(alice, {
      groqApiKeyEncrypted: encryptSecret(aliceKey),
      groqKeyMasked: maskSecret(aliceKey),
    });
    await upsertUserSettings(bob, {
      groqApiKeyEncrypted: encryptSecret(bobKey),
      groqKeyMasked: maskSecret(bobKey),
    });

    expect(await getGroqApiKey(alice)).toBe(aliceKey);
    expect(await getGroqApiKey(bob)).toBe(bobKey);
  });

  it("returns null rather than another user's key for an unknown user", async () => {
    expect(await getGroqApiKey(randomUUID())).toBeNull();
  });

  describe("dedup guarantees at the database level", () => {
    it("rejects a second transaction with the same (user, provider, ref_id)", async () => {
    // The unique index is the backstop under the in-memory dedup engine: even
    // if that engine is wrong, the same TrxID cannot land twice.
    const refId = `TRX-${randomUUID().slice(0, 8)}`;
    const base = {
      userId: alice,
      occurredAt: new Date("2026-04-01T06:00:00Z"),
      amountMinor: 50000,
      direction: "debit" as const,
      description: "Duplicate probe",
      provider: "bkash" as const,
      refId,
      rawText: "probe",
    };

    const first = await insertTransactions([base]);
    expect(first.insertedCount).toBe(1);

    const second = await insertTransactions([base]);
    expect(second.insertedCount).toBe(0);
    expect(second.skippedCount).toBe(1);
  });

  it("allows the same ref id for two different users", async () => {
    const refId = `SHARED-${randomUUID().slice(0, 8)}`;
    const row = {
      occurredAt: new Date("2026-04-02T06:00:00Z"),
      amountMinor: 25000,
      direction: "debit" as const,
      description: "Same ref, different people",
      provider: "bkash" as const,
      refId,
      rawText: "probe",
    };

    const a = await insertTransactions([{ ...row, userId: alice }]);
    const b = await insertTransactions([{ ...row, userId: bob }]);

    expect(a.insertedCount).toBe(1);
    expect(b.insertedCount).toBe(1);
    });
  });
});
