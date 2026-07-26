import { describe, it, expect } from "vitest";
import {
  parseAmount,
  parseAmountSigned,
  normaliseDigits,
  formatMoney,
  toMinor,
  toMajor,
} from "./money";

describe("normaliseDigits", () => {
  it("converts Bengali numerals to ASCII", () => {
    expect(normaliseDigits("১২৩৪৫৬৭৮৯০")).toBe("1234567890");
  });

  it("leaves non-digit characters untouched", () => {
    expect(normaliseDigits("Tk ১,২৩৪.৫৬")).toBe("Tk 1,234.56");
  });
});

describe("parseAmount", () => {
  it("parses a standard grouped decimal", () => {
    expect(parseAmount("1,234.56")?.minor).toBe(123456);
  });

  it("strips currency symbols and codes", () => {
    expect(parseAmount("Tk 1,234.56")?.minor).toBe(123456);
    expect(parseAmount("BDT 1,234.56")?.minor).toBe(123456);
    expect(parseAmount("৳1,234.56")?.minor).toBe(123456);
    expect(parseAmount("1,234.56 BDT")?.minor).toBe(123456);
  });

  it("parses Bengali numerals", () => {
    expect(parseAmount("৳১,২৩৪.৫৬")?.minor).toBe(123456);
  });

  it("treats a bare integer as whole taka", () => {
    expect(parseAmount("1234")?.minor).toBe(123400);
    expect(parseAmount("500")?.minor).toBe(50000);
  });

  it("reads a lone comma group as thousands, not a decimal", () => {
    // "1,234" in BD notation is one thousand two hundred thirty-four,
    // never 1.234 taka.
    expect(parseAmount("1,234")?.minor).toBe(123400);
  });

  it("reads a lone dot as a decimal point", () => {
    // BD/en convention: dot is the decimal separator, comma groups thousands.
    // So "1.234" is 1.23 taka after rounding, not 1,234 taka.
    expect(parseAmount("1.234")?.minor).toBe(123);
  });

  it("reads repeated dots as European grouping", () => {
    expect(parseAmount("1.234.567")?.minor).toBe(123456700);
  });

  it("reads a leading zero before a 3-digit group as a decimal", () => {
    // "0.555" cannot be grouping — nobody writes 0,555 for 555.
    expect(parseAmount("0.555")?.minor).toBe(56);
  });

  it("handles multiple grouping separators", () => {
    expect(parseAmount("1,234,567.89")?.minor).toBe(123456789);
  });

  it("handles European notation", () => {
    expect(parseAmount("1.234.567,89")?.minor).toBe(123456789);
    expect(parseAmount("1 234,56")?.minor).toBe(123456);
  });

  describe("negative markers", () => {
    it("detects a leading minus", () => {
      const parsed = parseAmount("-1,234.56");
      expect(parsed?.minor).toBe(123456);
      expect(parsed?.negative).toBe(true);
    });

    it("detects accounting parentheses", () => {
      const parsed = parseAmount("(1,234.56)");
      expect(parsed?.minor).toBe(123456);
      expect(parsed?.negative).toBe(true);
    });

    it("detects a Dr suffix as money out", () => {
      const parsed = parseAmount("1,234.56 Dr");
      expect(parsed?.minor).toBe(123456);
      expect(parsed?.negative).toBe(true);
    });

    it("treats a Cr suffix as positive", () => {
      const parsed = parseAmount("1,234.56 Cr");
      expect(parsed?.minor).toBe(123456);
      expect(parsed?.negative).toBe(false);
    });
  });

  describe("fractional handling", () => {
    it("pads a single decimal digit", () => {
      expect(parseAmount("12.5")?.minor).toBe(1250);
    });

    it("rounds half up beyond two decimals", () => {
      expect(parseAmount("10.555")?.minor).toBe(1056);
      expect(parseAmount("10.554")?.minor).toBe(1055);
    });

    it("carries into taka when poisha round to 100", () => {
      expect(parseAmount("10.999")?.minor).toBe(1100);
    });
  });

  describe("no-value inputs", () => {
    it.each([null, undefined, "", "   ", "-", "—", "N/A", "abc"])(
      "returns null for %p",
      (input) => {
        expect(parseAmount(input as string)).toBeNull();
      },
    );
  });

  it("never produces float artifacts", () => {
    // parseFloat("1234.56") * 100 === 123455.99999999999 — the exact bug this
    // parser exists to avoid. Every value must land on an integer.
    for (const value of ["1234.56", "0.07", "8.29", "19.99", "70.07"]) {
      const minor = parseAmount(value)!.minor;
      expect(Number.isInteger(minor)).toBe(true);
    }
    expect(parseAmount("1234.56")!.minor).toBe(123456);
    expect(parseAmount("0.07")!.minor).toBe(7);
    expect(parseAmount("70.07")!.minor).toBe(7007);
  });

  it("sums a realistic statement page without drift", () => {
    const rows = ["1,234.56", "89.99", "0.07", "12,000.00", "7.43"];
    const total = rows.reduce((sum, r) => sum + parseAmount(r)!.minor, 0);
    expect(total).toBe(123456 + 8999 + 7 + 1200000 + 743);
    expect(Number.isInteger(total)).toBe(true);
  });
});

describe("parseAmountSigned", () => {
  it("returns a negative number for debit markers", () => {
    expect(parseAmountSigned("(500.00)")).toBe(-50000);
    expect(parseAmountSigned("500.00")).toBe(50000);
    expect(parseAmountSigned("junk")).toBeNull();
  });
});

describe("toMinor / toMajor", () => {
  it("round-trips", () => {
    expect(toMinor(1234.56)).toBe(123456);
    expect(toMajor(123456)).toBe(1234.56);
  });

  it("rounds rather than truncating", () => {
    expect(toMinor(0.005)).toBe(1);
  });
});

describe("formatMoney", () => {
  it("formats minor units as taka", () => {
    expect(formatMoney(123456)).toContain("1,234.56");
  });

  it("drops poisha in compact mode for round amounts", () => {
    expect(formatMoney(120000, "BDT", { compact: true })).not.toContain(".00");
  });

  it("keeps poisha in compact mode when they are non-zero", () => {
    expect(formatMoney(120050, "BDT", { compact: true })).toContain(".50");
  });
});
