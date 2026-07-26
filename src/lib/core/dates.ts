import { normaliseDigits } from "./money";

/**
 * Date parsing for statements.
 *
 * The dangerous case is `03/04/2026` — March 4th or April 3rd depending on the
 * issuer. Guessing silently misfiles transactions by up to eleven months, and
 * the error is invisible because both readings are valid dates. So we never
 * assume: we scan the whole document for a row whose day component exceeds 12,
 * which settles the order for every other row in that document.
 */

export type DateOrder = "DMY" | "MDY" | "YMD";

/** Bangladesh Standard Time. Statements state local wall-clock time. */
export const APP_TIMEZONE = "Asia/Dhaka";
const BST_OFFSET_MINUTES = 6 * 60;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const NUMERIC_DATE = /(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/;
const TIME_PART = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i;

export interface DateOrderDetection {
  order: DateOrder;
  /** True when evidence settled it; false when we fell back to the BD default. */
  confident: boolean;
  evidence: string | null;
}

/**
 * Infer component order from a document's date strings.
 *
 * A component > 12 can only be a day, which pins the format. We check every
 * sample rather than stopping at the first, because early rows in a statement
 * are often the 1st–12th of the month and carry no information.
 */
export function detectDateOrder(samples: readonly string[]): DateOrderDetection {
  for (const sample of samples) {
    const match = NUMERIC_DATE.exec(normaliseDigits(sample));
    if (!match) continue;

    const [, a, b, c] = match;

    // Four-digit leading component is unambiguously a year.
    if (a.length === 4) {
      return { order: "YMD", confident: true, evidence: sample };
    }

    const first = Number(a);
    const second = Number(b);

    if (first > 12 && second <= 12) {
      return { order: "DMY", confident: true, evidence: sample };
    }
    if (second > 12 && first <= 12) {
      return { order: "MDY", confident: true, evidence: sample };
    }
    // Both > 12 is not a valid date in either order; ignore and keep scanning.
    void c;
  }

  // No row disambiguated. BD issuers use DD/MM/YYYY essentially universally.
  return { order: "DMY", confident: false, evidence: null };
}

/**
 * Parse a statement date string into a UTC instant, interpreting the wall-clock
 * value as Asia/Dhaka time.
 *
 * `order` only affects all-numeric dates; "05 Feb 2026" is unambiguous.
 */
export function parseStatementDate(
  raw: string | null | undefined,
  order: DateOrder = "DMY",
): Date | null {
  if (!raw) return null;
  const s = normaliseDigits(String(raw)).trim();
  if (!s) return null;

  const time = extractTime(s);
  const named = parseNamedMonth(s);
  if (named) {
    return toUtc(named.year, named.month, named.day, time);
  }

  const match = NUMERIC_DATE.exec(s);
  if (!match) return null;

  const [, a, b, c] = match;
  let year: number;
  let month: number;
  let day: number;

  if (a.length === 4) {
    year = Number(a);
    month = Number(b);
    day = Number(c);
  } else if (c.length === 4 || c.length === 2) {
    year = normaliseYear(Number(c));
    if (order === "MDY") {
      month = Number(a);
      day = Number(b);
    } else {
      day = Number(a);
      month = Number(b);
    }
  } else {
    return null;
  }

  if (!isValidYmd(year, month, day)) return null;
  return toUtc(year, month, day, time);
}

interface TimeParts {
  hour: number;
  minute: number;
  second: number;
}

function extractTime(s: string): TimeParts | null {
  const match = TIME_PART.exec(s);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  const meridiem = match[4]?.toUpperCase();

  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function parseNamedMonth(
  s: string,
): { year: number; month: number; day: number } | null {
  // "05 Feb 2026" / "5 February 2026"
  const dayFirst = /(\d{1,2})[\s\-.]*([A-Za-z]{3,9})[\s\-.,]*(\d{2,4})/.exec(s);
  if (dayFirst) {
    const month = MONTH_NAMES[dayFirst[2].toLowerCase()];
    if (month) {
      const year = normaliseYear(Number(dayFirst[3]));
      const day = Number(dayFirst[1]);
      if (isValidYmd(year, month, day)) return { year, month, day };
    }
  }

  // "Feb 05, 2026" / "February 5 2026"
  const monthFirst = /([A-Za-z]{3,9})[\s\-.]*(\d{1,2})[\s\-.,]*(\d{2,4})/.exec(s);
  if (monthFirst) {
    const month = MONTH_NAMES[monthFirst[1].toLowerCase()];
    if (month) {
      const year = normaliseYear(Number(monthFirst[3]));
      const day = Number(monthFirst[2]);
      if (isValidYmd(year, month, day)) return { year, month, day };
    }
  }

  return null;
}

/** Two-digit years: 70–99 → 19xx, 00–69 → 20xx. */
function normaliseYear(year: number): number {
  if (year >= 1000) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Build a UTC instant from Dhaka wall-clock components. */
function toUtc(
  year: number,
  month: number,
  day: number,
  time: TimeParts | null,
): Date {
  const ms = Date.UTC(
    year,
    month - 1,
    day,
    time?.hour ?? 0,
    time?.minute ?? 0,
    time?.second ?? 0,
  );
  return new Date(ms - BST_OFFSET_MINUTES * 60_000);
}

/** `2026-07` bucket key in Dhaka time — the unit every chart aggregates by. */
export function monthKey(date: Date): string {
  const local = new Date(date.getTime() + BST_OFFSET_MINUTES * 60_000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function formatMonthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
