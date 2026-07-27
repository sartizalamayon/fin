import { describe, expect, it } from "vitest";
import { DEFAULT_SIMILARITY_THRESHOLD } from "./index";
import { normaliseDescription, similarity, tokenise } from "./similarity";

describe("normaliseDescription", () => {
  it("flattens casing, punctuation and runaway whitespace", () => {
    expect(normaliseDescription("  Payment   to   SHWAPNO   Ltd.  ")).toBe(
      "payment shwapno ltd",
    );
  });

  it("strips the channel prefix statements glue onto merchants", () => {
    expect(normaliseDescription("BKASH*PAYMENT SHWAPNO LTD")).toBe(
      "payment shwapno ltd",
    );
    expect(normaliseDescription("NAGAD*MERCHANT PAY - AGORA")).toBe(
      "merchant pay agora",
    );
  });

  it("drops labelled reference numbers", () => {
    expect(normaliseDescription("Cash Out TrxID 8H2K9LMN01")).toBe("cash out");
    expect(normaliseDescription("Ref: 4471")).toBe("");
    expect(normaliseDescription("Payment Ref No 993217")).toBe("payment");
  });

  it("drops unlabelled transaction-id shaped tokens", () => {
    expect(normaliseDescription("PAYMENT SHWAPNO 8H2K9LMN01")).toBe(
      "payment shwapno",
    );
  });

  it("KEEPS phone numbers — they are what tells two sends apart", () => {
    expect(normaliseDescription("Send Money to 01711223344")).toBe(
      "send money 01711223344",
    );
    expect(normaliseDescription("Send Money to 01711223344")).not.toBe(
      normaliseDescription("Send Money to 01911998877"),
    );
  });

  it("keeps plain digits that were not labelled as a reference", () => {
    expect(tokenise("Shop 1234 purchase")).toContain("1234");
  });

  it("normalises Bengali numerals to ASCII", () => {
    expect(normaliseDescription("০১৭১১২২৩৩৪৪")).toBe("01711223344");
  });

  it("preserves Bengali script instead of deleting it", () => {
    expect(normaliseDescription("বিকাশ পেমেন্ট")).toBe("বিকাশ পেমেন্ট");
    expect(normaliseDescription("ক্যাশ আউট!!")).toBe("ক্যাশ আউট");
  });

  it("keeps 'fee' and 'charge' — a fee row is its own transaction", () => {
    expect(normaliseDescription("Cash Out Fee")).toBe("cash out fee");
    expect(normaliseDescription("Cash Out Fee")).not.toBe(
      normaliseDescription("Cash Out"),
    );
  });

  it("returns an empty string for nothing, null and pure punctuation", () => {
    expect(normaliseDescription(null)).toBe("");
    expect(normaliseDescription(undefined)).toBe("");
    expect(normaliseDescription("")).toBe("");
    expect(normaliseDescription("   ")).toBe("");
    expect(normaliseDescription("*** ### ---")).toBe("");
    expect(normaliseDescription("bKash TrxID")).toBe("");
  });
});

describe("similarity", () => {
  it("scores identical descriptions 1", () => {
    expect(similarity("Rickshaw fare", "Rickshaw fare")).toBe(1);
  });

  it("scores cross-channel wording of one payment as a match", () => {
    const score = similarity(
      "BKASH*PAYMENT SHWAPNO LTD",
      "Payment to SHWAPNO Ltd.",
    );
    expect(score).toBe(1);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it("tolerates a trailing legal suffix", () => {
    const score = similarity("PAYMENT SHWAPNO", "Payment to SHWAPNO LTD");
    expect(score).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it("keeps two same-shaped rickshaw fares apart", () => {
    const score = similarity("Rickshaw fare to office", "Rickshaw fare to Mirpur");
    expect(score).toBeLessThan(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it("scores unrelated merchants near zero", () => {
    expect(similarity("Tea and snacks", "Rickshaw fare")).toBeLessThan(0.3);
    expect(similarity("Salary credit", "Electricity bill")).toBeLessThan(0.3);
  });

  it("treats a bare merchant name plus a suffix as strong but not conclusive", () => {
    // Short strings carry little evidence, so this deliberately sits below the
    // collapse bar: a missed merge is recoverable, a wrong merge is not.
    const score = similarity("SHWAPNO", "SHWAPNO LTD");
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it("returns 0 when either side has no comparable content", () => {
    expect(similarity("", "")).toBe(0);
    expect(similarity(null, null)).toBe(0);
    expect(similarity("###", "###")).toBe(0);
    expect(similarity("bKash", "bKash")).toBe(0);
    expect(similarity("Rickshaw", "")).toBe(0);
  });

  it("is symmetric", () => {
    const pairs: [string, string][] = [
      ["Payment to SHWAPNO", "SHWAPNO payment"],
      ["Rickshaw fare", "Tea stall"],
      ["Cash Out agent 01711223344", "Cash out"],
      ["বিকাশ পেমেন্ট", "পেমেন্ট"],
    ];
    for (const [a, b] of pairs) {
      expect(similarity(a, b)).toBe(similarity(b, a));
    }
  });

  it("always lands inside 0..1", () => {
    const samples = [
      "",
      "a",
      "Payment",
      "BKASH*PAYMENT SHWAPNO LTD TrxID 8H2K9LMN01",
      "০১৭১১২২৩৩৪৪",
      "Cash Out Fee",
      "সেন্ড মানি",
    ];
    for (const a of samples) {
      for (const b of samples) {
        const score = similarity(a, b);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is word-order insensitive enough for reordered statement columns", () => {
    expect(
      similarity("SHWAPNO LTD payment", "payment SHWAPNO LTD"),
    ).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it("is deterministic", () => {
    const a = "BKASH*PAYMENT SHWAPNO LTD";
    const b = "Payment SHWAPNO";
    expect(similarity(a, b)).toBe(similarity(a, b));
  });
});
