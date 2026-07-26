import { describe, it, expect } from "vitest";
import {
  detectDateOrder,
  parseStatementDate,
  monthKey,
  formatMonthLabel,
} from "./dates";

/** Dhaka is UTC+6, so local midnight is 18:00 UTC the previous day. */
function dhakaMidnightUtc(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 6 * 3600_000).toISOString();
}

describe("detectDateOrder", () => {
  it("infers DMY when a day component exceeds 12", () => {
    const result = detectDateOrder(["05/03/2026", "25/03/2026"]);
    expect(result.order).toBe("DMY");
    expect(result.confident).toBe(true);
    expect(result.evidence).toBe("25/03/2026");
  });

  it("infers MDY when the second component exceeds 12", () => {
    const result = detectDateOrder(["03/25/2026"]);
    expect(result.order).toBe("MDY");
    expect(result.confident).toBe(true);
  });

  it("infers YMD from a four-digit leading component", () => {
    const result = detectDateOrder(["2026-03-05"]);
    expect(result.order).toBe("YMD");
    expect(result.confident).toBe(true);
  });

  it("keeps scanning past ambiguous rows to find evidence", () => {
    // The first rows are all <= 12 in both positions and settle nothing. The
    // detector must not stop at the first sample.
    const result = detectDateOrder([
      "01/02/2026",
      "03/04/2026",
      "05/06/2026",
      "19/06/2026",
    ]);
    expect(result.order).toBe("DMY");
    expect(result.confident).toBe(true);
    expect(result.evidence).toBe("19/06/2026");
  });

  it("falls back to DMY without confidence when nothing disambiguates", () => {
    // Every row is ambiguous. BD issuers use DD/MM/YYYY, so that is the
    // fallback — but confident=false lets callers surface the uncertainty.
    const result = detectDateOrder(["01/02/2026", "03/04/2026"]);
    expect(result.order).toBe("DMY");
    expect(result.confident).toBe(false);
    expect(result.evidence).toBeNull();
  });

  it("returns the unconfident default for empty input", () => {
    expect(detectDateOrder([]).confident).toBe(false);
  });
});

describe("parseStatementDate", () => {
  it("reads the SAME string differently under DMY and MDY", () => {
    // This is the whole reason detectDateOrder exists. Getting it wrong
    // misfiles a transaction by up to eleven months, silently.
    const dmy = parseStatementDate("03/04/2026", "DMY")!;
    const mdy = parseStatementDate("03/04/2026", "MDY")!;
    expect(dmy.toISOString()).toBe(dhakaMidnightUtc(2026, 4, 3));
    expect(mdy.toISOString()).toBe(dhakaMidnightUtc(2026, 3, 4));
    expect(dmy.getTime()).not.toBe(mdy.getTime());
  });

  it("parses ISO dates regardless of the order hint", () => {
    expect(parseStatementDate("2026-03-05", "MDY")!.toISOString()).toBe(
      dhakaMidnightUtc(2026, 3, 5),
    );
  });

  it("accepts dash and dot separators", () => {
    const expected = dhakaMidnightUtc(2026, 4, 3);
    expect(parseStatementDate("03-04-2026", "DMY")!.toISOString()).toBe(expected);
    expect(parseStatementDate("03.04.2026", "DMY")!.toISOString()).toBe(expected);
  });

  it("parses day-first named months", () => {
    expect(parseStatementDate("05 Feb 2026")!.toISOString()).toBe(
      dhakaMidnightUtc(2026, 2, 5),
    );
    expect(parseStatementDate("5 February 2026")!.toISOString()).toBe(
      dhakaMidnightUtc(2026, 2, 5),
    );
  });

  it("parses month-first named months", () => {
    expect(parseStatementDate("Feb 05, 2026")!.toISOString()).toBe(
      dhakaMidnightUtc(2026, 2, 5),
    );
  });

  it("parses Bengali numerals", () => {
    expect(parseStatementDate("০৫/০২/২০২৬", "DMY")!.toISOString()).toBe(
      dhakaMidnightUtc(2026, 2, 5),
    );
  });

  describe("time components", () => {
    it("applies 24-hour times as Dhaka local", () => {
      const d = parseStatementDate("05/02/2026 14:30", "DMY")!;
      expect(d.toISOString()).toBe(
        new Date(Date.UTC(2026, 1, 5, 14, 30) - 6 * 3600_000).toISOString(),
      );
    });

    it("applies PM correctly", () => {
      const d = parseStatementDate("05/02/2026 02:30 PM", "DMY")!;
      expect(d.getUTCHours()).toBe(8); // 14:30 Dhaka = 08:30 UTC
    });

    it("treats 12 AM as midnight", () => {
      const d = parseStatementDate("05/02/2026 12:15 AM", "DMY")!;
      expect(d.toISOString()).toBe(
        new Date(Date.UTC(2026, 1, 5, 0, 15) - 6 * 3600_000).toISOString(),
      );
    });
  });

  describe("two-digit years", () => {
    it("maps 00-69 to 2000s", () => {
      expect(parseStatementDate("05/02/26", "DMY")!.toISOString()).toBe(
        dhakaMidnightUtc(2026, 2, 5),
      );
    });

    it("maps 70-99 to 1900s", () => {
      expect(parseStatementDate("05/02/95", "DMY")!.getUTCFullYear()).toBe(1995);
    });
  });

  describe("invalid input", () => {
    it.each([null, undefined, "", "not a date", "99/99/2026", "31/02/2026"])(
      "returns null for %p",
      (input) => {
        expect(parseStatementDate(input as string)).toBeNull();
      },
    );

    it("rejects a day that does not exist in that month", () => {
      // 31 April is not a date; must not silently roll into 1 May.
      expect(parseStatementDate("31/04/2026", "DMY")).toBeNull();
    });

    it("accepts a valid leap day", () => {
      expect(parseStatementDate("29/02/2024", "DMY")).not.toBeNull();
      expect(parseStatementDate("29/02/2026", "DMY")).toBeNull();
    });
  });
});

describe("monthKey", () => {
  it("buckets by Dhaka month, not UTC", () => {
    // 18:30 UTC on 31 Jan is 00:30 on 1 Feb in Dhaka. Bucketing by UTC would
    // file this under January and shift a chunk of every month's spending.
    const instant = new Date(Date.UTC(2026, 0, 31, 18, 30));
    expect(monthKey(instant)).toBe("2026-02");
  });

  it("zero-pads single-digit months", () => {
    expect(monthKey(new Date(Date.UTC(2026, 2, 15, 6, 0)))).toBe("2026-03");
  });
});

describe("formatMonthLabel", () => {
  it("renders a short human label", () => {
    expect(formatMonthLabel("2026-03")).toBe("Mar 2026");
  });
});
