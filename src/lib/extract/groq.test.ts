import { describe, it, expect, vi } from "vitest";

import { GroqLlmProvider, splitStatement, mergeExtractions } from "./groq";
import { InvalidApiKeyError, LlmResponseError, RateLimitError } from "./errors";
import type { StatementExtraction } from "@/lib/core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extraction(over: Partial<StatementExtraction> = {}): StatementExtraction {
  return {
    provider: "bkash",
    accountRef: "****4471",
    currency: "BDT",
    periodStart: "01/03/2026",
    periodEnd: "31/03/2026",
    openingBalanceMinor: 100000,
    closingBalanceMinor: 90000,
    rows: [],
    ...over,
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    occurredAt: "2026-03-05T12:00:00+06:00",
    amountMinor: 10000,
    direction: "debit",
    currency: "BDT",
    refId: "ABC12345",
    counterparty: "Shwapno",
    description: "Payment",
    provider: "bkash",
    accountRef: "****4471",
    feeMinor: 0,
    balanceAfterMinor: 90000,
    rawText: "05/03/2026 Payment Shwapno 100.00",
    ...over,
  };
}

/**
 * A stub standing in for the Groq SDK's `chat.completions.create`.
 *
 * Queued responses are served in order; once the queue drains the last one
 * repeats, so a test does not have to know exactly how many chunks the splitter
 * will produce.
 */
function stubClient(responses: string[]) {
  const create = vi.fn();
  for (const content of responses) {
    create.mockResolvedValueOnce({ choices: [{ message: { content } }] });
  }
  const last = responses[responses.length - 1];
  if (last !== undefined) {
    create.mockResolvedValue({ choices: [{ message: { content: last } }] });
  }
  return { client: { chat: { completions: { create } } } as never, create };
}

function failingClient(error: unknown) {
  const create = vi.fn().mockRejectedValue(error);
  return { client: { chat: { completions: { create } } } as never, create };
}

// ---------------------------------------------------------------------------

describe("splitStatement", () => {
  it("returns a single chunk when the text fits", () => {
    expect(splitStatement("short text", 1000)).toEqual(["short text"]);
  });

  it("never splits mid-line", () => {
    // A transaction row cut in half would be dropped by one chunk and mangled
    // by the other, surfacing later as a confusing reconciliation failure.
    const lines = Array.from({ length: 50 }, (_, i) => `row ${i} some content here`);
    const chunks = splitStatement(lines.join("\n"), 200);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        expect(lines).toContain(line);
      }
    }
  });

  it("preserves every line across the split", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line-${i}`);
    const chunks = splitStatement(lines.join("\n"), 100);
    expect(chunks.join("\n").split("\n")).toEqual(lines);
  });
});

describe("mergeExtractions", () => {
  it("returns the single extraction unchanged", () => {
    const one = extraction();
    expect(mergeExtractions([one])).toBe(one);
  });

  it("takes opening from the first chunk and closing from the last", () => {
    // Balances are positional, not additive. Summing them, or taking the first
    // non-null of each, would corrupt the figures reconciliation depends on.
    const merged = mergeExtractions([
      extraction({ openingBalanceMinor: 500000, closingBalanceMinor: 400000 }),
      extraction({ openingBalanceMinor: 400000, closingBalanceMinor: 250000 }),
      extraction({ openingBalanceMinor: 250000, closingBalanceMinor: 120000 }),
    ]);

    expect(merged.openingBalanceMinor).toBe(500000);
    expect(merged.closingBalanceMinor).toBe(120000);
  });

  it("concatenates rows in chunk order", () => {
    const merged = mergeExtractions([
      extraction({ rows: [row({ refId: "AAA1" })] as never }),
      extraction({ rows: [row({ refId: "BBB2" }), row({ refId: "CCC3" })] as never }),
    ]);

    expect(merged.rows.map((r) => r.refId)).toEqual(["AAA1", "BBB2", "CCC3"]);
  });

  it("spans the period from first start to last end", () => {
    const merged = mergeExtractions([
      extraction({ periodStart: "01/01/2026", periodEnd: "31/01/2026" }),
      extraction({ periodStart: "01/02/2026", periodEnd: "28/02/2026" }),
    ]);

    expect(merged.periodStart).toBe("01/01/2026");
    expect(merged.periodEnd).toBe("28/02/2026");
  });

  it("throws on an empty list rather than inventing a statement", () => {
    expect(() => mergeExtractions([])).toThrow(LlmResponseError);
  });
});

describe("GroqLlmProvider", () => {
  it("rejects construction without an API key", () => {
    expect(() => new GroqLlmProvider("")).toThrow(InvalidApiKeyError);
  });

  it("parses a valid response", async () => {
    const { client } = stubClient([
      JSON.stringify(extraction({ rows: [row()] as never })),
    ]);
    const provider = new GroqLlmProvider("gsk_test", { client });

    const result = await provider.extractStatement({ text: "statement" });
    expect(result.rows).toHaveLength(1);
    expect(result.openingBalanceMinor).toBe(100000);
  });

  it("strips a markdown code fence around the JSON", async () => {
    const { client } = stubClient([
      "```json\n" + JSON.stringify(extraction()) + "\n```",
    ]);
    const provider = new GroqLlmProvider("gsk_test", { client });

    await expect(provider.extractStatement({ text: "x" })).resolves.toMatchObject({
      provider: "bkash",
    });
  });

  it("retries once with the validation error and accepts the repair", async () => {
    const { client, create } = stubClient([
      JSON.stringify({ provider: "bkash", rows: "not-an-array" }),
      JSON.stringify(extraction({ rows: [row()] as never })),
    ]);
    const provider = new GroqLlmProvider("gsk_test", { client });

    const result = await provider.extractStatement({ text: "statement" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(1);
  });

  it("gives up after one failed repair rather than guessing", async () => {
    const { client, create } = stubClient([
      JSON.stringify({ bad: true }),
      JSON.stringify({ still: "bad" }),
    ]);
    const provider = new GroqLlmProvider("gsk_test", { client });

    await expect(provider.extractStatement({ text: "x" })).rejects.toThrow(
      LlmResponseError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejects a float amount instead of silently rounding it", async () => {
    // Money must arrive as integer poisha. A float here means the model did the
    // taka→poisha conversion wrong, and coercing it would hide that.
    const { client } = stubClient([
      JSON.stringify(extraction({ rows: [row({ amountMinor: 845.5 })] as never })),
      JSON.stringify(extraction({ rows: [row({ amountMinor: 845.5 })] as never })),
    ]);
    const provider = new GroqLlmProvider("gsk_test", { client });

    await expect(provider.extractStatement({ text: "x" })).rejects.toThrow(
      LlmResponseError,
    );
  });

  it("splits a long statement into several requests and merges them", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `row ${i} padding text`).join("\n");
    const { client, create } = stubClient([
      JSON.stringify(
        extraction({ openingBalanceMinor: 500000, closingBalanceMinor: 400000, rows: [row({ refId: "AAA1" })] as never }),
      ),
      JSON.stringify(
        extraction({ openingBalanceMinor: 400000, closingBalanceMinor: 300000, rows: [row({ refId: "BBB2" })] as never }),
      ),
    ]);
    const provider = new GroqLlmProvider("gsk_test", { client, chunkChars: 2000 });

    const result = await provider.extractStatement({ text: long });
    expect(create.mock.calls.length).toBeGreaterThan(1);
    expect(result.openingBalanceMinor).toBe(500000);
    expect(result.closingBalanceMinor).toBe(300000);
  });

  describe("error translation", () => {
    it("maps 401 to an actionable invalid-key error", async () => {
      const { client } = failingClient(Object.assign(new Error("nope"), { status: 401 }));
      const provider = new GroqLlmProvider("gsk_bad", { client });

      await expect(provider.extractStatement({ text: "x" })).rejects.toThrow(
        InvalidApiKeyError,
      );
    });

    it("maps 429 to a rate-limit error carrying retry-after", async () => {
      const { client } = failingClient(
        Object.assign(new Error("slow down"), {
          status: 429,
          headers: { "retry-after": "30" },
        }),
      );
      const provider = new GroqLlmProvider("gsk_test", { client });

      await expect(
        provider.extractStatement({ text: "x" }),
      ).rejects.toMatchObject({ retryAfterSeconds: 30 });
      await expect(provider.extractStatement({ text: "x" })).rejects.toThrow(
        RateLimitError,
      );
    });

    it("treats an empty completion as a response error", async () => {
      const { client } = stubClient(["", ""]);
      const provider = new GroqLlmProvider("gsk_test", { client });

      await expect(provider.extractStatement({ text: "x" })).rejects.toThrow(
        LlmResponseError,
      );
    });
  });
});
