import { describe, it, expect } from "vitest";

import {
  findPeriodOverlap,
  isWithinOverlap,
  overlapDays,
  type ExistingPeriodDocument,
} from "./periods";

/**
 * Overlapping statement uploads.
 *
 * Upload Jan–Mar, then later Feb–Apr, and February arrives twice. The rows in
 * that window need extra scrutiny — this module finds the contested dates so
 * the caller knows where to look.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function doc(
  id: string,
  start: string,
  end: string,
  provider: ExistingPeriodDocument["provider"] = "bkash",
): ExistingPeriodDocument {
  return { id, provider, periodStart: d(start), periodEnd: d(end) };
}

describe("findPeriodOverlap", () => {
  it("finds the contested window of a partial overlap", () => {
    // Jan–Mar already imported, now uploading Feb–Apr.
    const overlaps = findPeriodOverlap(
      { provider: "bkash", periodStart: d("2026-02-01"), periodEnd: d("2026-04-30") },
      [doc("jan-mar", "2026-01-01", "2026-03-31")],
    );

    expect(overlaps).not.toBeNull();
    expect(overlaps).toHaveLength(1);
    expect(overlaps![0].start).toEqual(d("2026-02-01"));
    expect(overlaps![0].end).toEqual(d("2026-03-31"));
    expect(overlaps![0].documentIds).toEqual(["jan-mar"]);
  });

  it("finds a full containment", () => {
    const overlaps = findPeriodOverlap(
      { provider: "bkash", periodStart: d("2026-02-10"), periodEnd: d("2026-02-20") },
      [doc("whole-feb", "2026-02-01", "2026-02-28")],
    );

    expect(overlaps![0].start).toEqual(d("2026-02-10"));
    expect(overlaps![0].end).toEqual(d("2026-02-20"));
  });

  it("finds an overlap when the new document swallows the old one", () => {
    const overlaps = findPeriodOverlap(
      { provider: "bkash", periodStart: d("2026-01-01"), periodEnd: d("2026-12-31") },
      [doc("feb", "2026-02-01", "2026-02-28")],
    );

    expect(overlaps![0].start).toEqual(d("2026-02-01"));
    expect(overlaps![0].end).toEqual(d("2026-02-28"));
  });

  it("treats a shared boundary day as an overlap", () => {
    // Periods are inclusive, so a statement ending 31 Mar and one starting
    // 31 Mar both contain that day's transactions.
    const overlaps = findPeriodOverlap(
      { provider: "bkash", periodStart: d("2026-03-31"), periodEnd: d("2026-04-30") },
      [doc("jan-mar", "2026-01-01", "2026-03-31")],
    );

    expect(overlaps).not.toBeNull();
    expect(overlaps![0].start).toEqual(d("2026-03-31"));
  });

  it("returns null for adjacent, non-overlapping periods", () => {
    const overlaps = findPeriodOverlap(
      { provider: "bkash", periodStart: d("2026-04-01"), periodEnd: d("2026-04-30") },
      [doc("jan-mar", "2026-01-01", "2026-03-31")],
    );

    expect(overlaps).toBeNull();
  });

  it("groups several documents covering the same window", () => {
    const overlaps = findPeriodOverlap(
      { provider: "bkash", periodStart: d("2026-02-01"), periodEnd: d("2026-02-28") },
      [
        doc("first", "2026-02-01", "2026-02-28"),
        doc("second", "2026-02-01", "2026-02-28"),
      ],
    );

    expect(overlaps).toHaveLength(1);
    expect(overlaps![0].documentIds.sort()).toEqual(["first", "second"]);
  });

  describe("provider scoping", () => {
    it("ignores a different provider by default", () => {
      // A bKash statement and a bank statement covering the same month are not
      // a duplication risk — they describe different accounts.
      const overlaps = findPeriodOverlap(
        { provider: "bkash", periodStart: d("2026-02-01"), periodEnd: d("2026-02-28") },
        [doc("bank-feb", "2026-02-01", "2026-02-28", "bank")],
      );

      expect(overlaps).toBeNull();
    });

    it("compares across providers when asked", () => {
      const overlaps = findPeriodOverlap(
        { provider: "bkash", periodStart: d("2026-02-01"), periodEnd: d("2026-02-28") },
        [doc("bank-feb", "2026-02-01", "2026-02-28", "bank")],
        { sameProviderOnly: false },
      );

      expect(overlaps).not.toBeNull();
    });
  });

  describe("missing and malformed input", () => {
    it("returns null when the new document has no period", () => {
      expect(
        findPeriodOverlap({ periodStart: null, periodEnd: null }, [
          doc("feb", "2026-02-01", "2026-02-28"),
        ]),
      ).toBeNull();
    });

    it("skips stored documents with no period", () => {
      const overlaps = findPeriodOverlap(
        { provider: "bkash", periodStart: d("2026-02-01"), periodEnd: d("2026-02-28") },
        [{ id: "unknown", provider: "bkash", periodStart: null, periodEnd: null }],
      );

      expect(overlaps).toBeNull();
    });

    it("does not report a document overlapping itself", () => {
      // Re-checking a saved document must not flag it against its own row.
      const overlaps = findPeriodOverlap(
        {
          id: "same",
          provider: "bkash",
          periodStart: d("2026-02-01"),
          periodEnd: d("2026-02-28"),
        },
        [doc("same", "2026-02-01", "2026-02-28")],
      );

      expect(overlaps).toBeNull();
    });

    it("tolerates a reversed period", () => {
      const overlaps = findPeriodOverlap(
        { provider: "bkash", periodStart: d("2026-02-28"), periodEnd: d("2026-02-01") },
        [doc("feb", "2026-02-01", "2026-02-28")],
      );

      expect(overlaps).not.toBeNull();
    });

    it("returns null against an empty ledger", () => {
      expect(
        findPeriodOverlap(
          { periodStart: d("2026-02-01"), periodEnd: d("2026-02-28") },
          [],
        ),
      ).toBeNull();
    });
  });
});

describe("isWithinOverlap", () => {
  const overlaps = [
    { start: d("2026-02-01"), end: d("2026-02-28"), documentIds: ["feb"] },
  ];

  it("flags a date inside the contested window", () => {
    expect(isWithinOverlap(d("2026-02-14"), overlaps)).toBe(true);
  });

  it("includes both boundaries", () => {
    expect(isWithinOverlap(d("2026-02-01"), overlaps)).toBe(true);
    expect(isWithinOverlap(d("2026-02-28"), overlaps)).toBe(true);
  });

  it("excludes dates outside it", () => {
    expect(isWithinOverlap(d("2026-01-31"), overlaps)).toBe(false);
    expect(isWithinOverlap(d("2026-03-01"), overlaps)).toBe(false);
  });

  it("is false when there are no overlaps at all", () => {
    expect(isWithinOverlap(d("2026-02-14"), null)).toBe(false);
    expect(isWithinOverlap(d("2026-02-14"), [])).toBe(false);
  });
});

describe("overlapDays", () => {
  it("counts the contested days inclusively", () => {
    expect(
      overlapDays([
        { start: d("2026-02-01"), end: d("2026-02-03"), documentIds: ["x"] },
      ]),
    ).toBe(3);
  });

  it("counts a single shared day as one", () => {
    expect(
      overlapDays([
        { start: d("2026-03-31"), end: d("2026-03-31"), documentIds: ["x"] },
      ]),
    ).toBe(1);
  });

  it("is zero for nothing", () => {
    expect(overlapDays(null)).toBe(0);
    expect(overlapDays([])).toBe(0);
  });
});
