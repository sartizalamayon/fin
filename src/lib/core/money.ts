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
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  if (lastDot === -1 && lastComma === -1) return null;

  // Whichever appears last is the decimal candidate.
  const candidate: "." | "," = lastDot > lastComma ? "." : ",";
  const candidateIndex = Math.max(lastDot, lastComma);
  const digitsAfter = s.slice(candidateIndex + 1).replace(/\D/g, "").length;

  // Exactly 3 trailing digits with a preceding separator of the other kind, or
  // repeated separators of the same kind, means grouping — e.g. "1,234,567".
  const other = candidate === "." ? "," : ".";
  const hasOther = s.indexOf(other) !== -1;
  const sameKindCount = s.split(candidate).length - 1;

  if (digitsAfter === 3 && (hasOther || sameKindCount > 1)) return null;
  // A lone "1,234" / "1.234" with 3 trailing digits reads as grouping in BD.
  if (digitsAfter === 3 && !hasOther && sameKindCount === 1) return null;
  if (digitsAfter === 0) return null;

  return candidate;
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
