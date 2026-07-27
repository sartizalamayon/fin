import { APP_TIMEZONE } from "@/lib/core/dates";

/**
 * Date display for statement data.
 *
 * Statement instants are stored as UTC but *mean* Dhaka wall-clock time, so
 * they are formatted back in Asia/Dhaka. Formatting in the viewer's local zone
 * would shift a 1 June transaction to 31 May for anyone travelling, which reads
 * as a bug in the extractor rather than a display quirk.
 */

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: APP_TIMEZONE,
});

const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: APP_TIMEZONE,
});

const MONTH_YEAR_PARTS = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: APP_TIMEZONE,
});

export function formatDay(date: Date): string {
  return DAY_MONTH.format(date);
}

export function formatFullDate(date: Date): string {
  return DAY_MONTH_YEAR.format(date);
}

/** "1–30 Jun 2026" when it stays inside one month, else both full dates. */
export function formatPeriod(
  start: Date | null,
  end: Date | null,
): string | null {
  if (!start && !end) return null;
  if (start && !end) return `From ${formatFullDate(start)}`;
  if (!start && end) return `Up to ${formatFullDate(end)}`;
  if (!start || !end) return null;

  if (MONTH_YEAR_PARTS.format(start) === MONTH_YEAR_PARTS.format(end)) {
    return `${DAY_MONTH.formatToParts(start).find((p) => p.type === "day")?.value ?? formatDay(start)}–${formatFullDate(end)}`;
  }
  return `${formatFullDate(start)} – ${formatFullDate(end)}`;
}
