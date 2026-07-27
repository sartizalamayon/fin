/**
 * Chart and amount colours.
 *
 * Only two series exist on this dashboard — money in and money out — so the
 * colour job is polarity, not identity. The pair was checked with the data-viz
 * validator against both surfaces (light `#ffffff`, dark `#171717`):
 *
 *   blue ↔ red   CVD ΔE 21.6 light / 19.2 dark, normal-vision 32.3 / 29.0  PASS
 *
 * Green-for-income was measured and rejected: green `#008300` against red
 * `#e34948` scores a protan ΔE of 7.2 — the two bars merge for red-green colour
 * blindness, which is the one pair a money chart must never confuse. Blue/red
 * keeps the "opposite poles" reading and separates under every simulation.
 *
 * The category breakdown deliberately uses a **single** hue (the money-out red,
 * because a spending breakdown is the expense series decomposed): bar length
 * carries magnitude and the row label carries identity, so a second colour
 * dimension would encode nothing. That also sidesteps the twelve-category
 * problem — no validated categorical palette has twelve safe hues.
 *
 * Colour is never the only channel: amounts carry an explicit +/− sign, the
 * trend chart is legended, and every category row prints name, amount and share
 * as text.
 */

export interface SeriesColor {
  light: string;
  dark: string;
}

export const MONEY_IN: SeriesColor = { light: "#2a78d6", dark: "#3987e5" };
export const MONEY_OUT: SeriesColor = { light: "#e34948", dark: "#e66767" };

/**
 * Text steps, darkened/lightened until they clear WCAG AA against their own
 * surface (6.63:1 and 5.88:1 on white; 8.50:1 and 5.55:1 on `#171717`).
 * The mark colours above are fills — they are not contrast-safe as text.
 */
export const MONEY_IN_TEXT = "text-[#1c5cab] dark:text-[#86b6ef]";
export const MONEY_OUT_TEXT = "text-[#c0272d] dark:text-[#e66767]";

/** Bar fills, as Tailwind arbitrary values for the non-Recharts bar list. */
export const MONEY_IN_FILL = "bg-[#2a78d6] dark:bg-[#3987e5]";
export const MONEY_OUT_FILL = "bg-[#e34948] dark:bg-[#e66767]";

export function directionToneClass(direction: "credit" | "debit"): string {
  return direction === "credit" ? MONEY_IN_TEXT : MONEY_OUT_TEXT;
}

export function directionFillClass(direction: "credit" | "debit"): string {
  return direction === "credit" ? MONEY_IN_FILL : MONEY_OUT_FILL;
}

/** Positive net reads as money in, negative as money out, zero stays ink. */
export function netToneClass(netMinor: number): string {
  if (netMinor > 0) return MONEY_IN_TEXT;
  if (netMinor < 0) return MONEY_OUT_TEXT;
  return "text-foreground";
}
