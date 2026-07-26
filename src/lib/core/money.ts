/**
 * Money parsing and formatting.
 *
 * Everything is integer minor units (poisha). Amount strings are parsed by
 * splitting on the decimal separator and handling each side as an integer —
 * never `parseFloat(x) * 100`, which silently produces 1234.5599999999999 and
 * turns into off-by-one-poisha reconciliation failures at scale.
 */

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Bank statements in BD sometimes render figures in Bengali numerals. */
export function normaliseDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const bengaliIndex = BENGALI_DIGITS.indexOf(ch);
    out += bengaliIndex === -1 ? ch : String(bengaliIndex);
  }
  return out;
}

/** Currency symbols and codes that appear glued to amounts in BD statements. */
const CURRENCY_NOISE = /(?:BDT|TAKA|TK\.?|USD|EUR|GBP|INR|৳|\$|€|£|₹)/gi;

export interface ParsedAmount {
  minor: number;
  /** True when the source marked the value negative — via sign, parens, or Dr. */
  negative: boolean;
}

/**
 * Parse a money string into minor units.
 *
 * Handles: "1,234.56", "Tk 1,234.56", "৳১,২৩৪.৫৬", "(1,234.56)", "1234.56 Dr",
 * "1 234,56" (space-grouped, comma-decimal), and bare integers.
 * Returns null for blanks, dashes, and anything with no digits.
 */
export function parseAmount(raw: string | null | undefined): ParsedAmount | null {
  if (raw == null) return null;

  let s = normaliseDigits(String(raw)).trim();
  if (s === "" || /^[-–—.]+$/.test(s)) return null;

  let negative = false;

  // Accounting parentheses: (1,234.56) means -1234.56
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  // Dr/Cr suffix or prefix. Dr = debit = money out.
  if (/(^|\s)DR\.?($|\s)/i.test(s)) negative = true;
  s = s.replace(/(^|\s)(DR|CR)\.?($|\s)/gi, " ");

  s = s.replace(CURRENCY_NOISE, " ");

  if (/^\s*-/.test(s)) negative = true;
  s = s.replace(/[+\-–—]/g, " ");

  // Strip everything that is not a digit or a potential separator.
  s = s.replace(/[^\d.,\s]/g, "").trim();
  if (!/\d/.test(s)) return null;

  const decimalSeparator = detectDecimalSeparator(s);

  let integerPart: string;
  let fractionPart: string;

  if (decimalSeparator) {
    const lastIndex = s.lastIndexOf(decimalSeparator);
    integerPart = s.slice(0, lastIndex);
    fractionPart = s.slice(lastIndex + 1);
  } else {
    integerPart = s;
    fractionPart = "";
  }

  integerPart = integerPart.replace(/\D/g, "");
  fractionPart = fractionPart.replace(/\D/g, "");

  if (integerPart === "" && fractionPart === "") return null;

  // Normalise the fraction to exactly two digits (round half up on 3+).
  let poisha: number;
  if (fractionPart.length === 0) {
    poisha = 0;
  } else if (fractionPart.length === 1) {
    poisha = Number(fractionPart) * 10;
  } else if (fractionPart.length === 2) {
    poisha = Number(fractionPart);
  } else {
    const twoDigits = Number(fractionPart.slice(0, 2));
    const next = Number(fractionPart[2]);
    poisha = next >= 5 ? twoDigits + 1 : twoDigits;
  }

  let major = Number(integerPart === "" ? "0" : integerPart);
  if (poisha === 100) {
    major += 1;
    poisha = 0;
  }

  if (!Number.isSafeInteger(major)) return null;

  return { minor: major * 100 + poisha, negative };
}

/**
 * Work out which of `.` or `,` is the decimal point.
 *
 * Ambiguity is real: "1,234" is one thousand-plus in BD/US notation but could
 * be 1.234 in EU notation. We resolve by position and group length — a
 * separator with exactly 3 digits after it and another separator earlier is a
 * thousands mark, not a decimal.
 */
function detectDecimalSeparator(s: string): "." | "," | null {
  const dotCount = (s.match(/\./g) ?? []).length;
  const commaCount = (s.match(/,/g) ?? []).length;

  if (dotCount === 0 && commaCount === 0) return null;

  // Both kinds present: whichever appears last is the decimal point. This
  // resolves "1,234.56" (en) and "1.234.567,89" (EU) without extra guessing.
  if (dotCount > 0 && commaCount > 0) {
    const candidate: "." | "," =
      s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    return trailingDigits(s, candidate) === 0 ? null : candidate;
  }

  // Only one kind present. Repeats can only be grouping: "1.234.567".
  const only: "." | "," = dotCount > 0 ? "." : ",";
  const count = dotCount > 0 ? dotCount : commaCount;
  if (count > 1) return null;

  const after = trailingDigits(s, only);
  if (after === 0) return null;

  // BD and en notation: the dot is the decimal point and the comma groups
  // thousands. So a lone comma with exactly three trailing digits is grouping
  // ("1,234" is one thousand plus, never 1.234), while a lone dot is always a
  // decimal point ("10.555" is ten-point-five-five-five, not ten thousand).
  // Statement amounts carry two decimals in practice, so the remaining
  // ambiguity is rare — and reconciliation catches it if this call is wrong.
  if (only === "," && after === 3) return null;

  return only;
}

function trailingDigits(s: string, separator: "." | ","): number {
  return s.slice(s.lastIndexOf(separator) + 1).replace(/\D/g, "").length;
}

/** Convenience: parse and return signed minor units, or null. */
export function parseAmountSigned(raw: string | null | undefined): number | null {
  const parsed = parseAmount(raw);
  if (!parsed) return null;
  return parsed.negative ? -parsed.minor : parsed.minor;
}

export function toMinor(major: number): number {
  return Math.round(major * 100);
}

export function toMajor(minor: number): number {
  return minor / 100;
}

const FORMATTERS = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, decimals: boolean): Intl.NumberFormat {
  const key = `${currency}:${decimals}`;
  let fmt = FORMATTERS.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    });
    FORMATTERS.set(key, fmt);
  }
  return fmt;
}

/** Display helper. `compact` drops poisha, which is what charts and tiles want. */
export function formatMoney(
  minor: number,
  currency: string = "BDT",
  options: { compact?: boolean } = {},
): string {
  const showDecimals = !options.compact || minor % 100 !== 0;
  return formatterFor(currency, showDecimals).format(minor / 100);
}
