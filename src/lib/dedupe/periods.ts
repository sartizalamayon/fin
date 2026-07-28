import type { Provider } from "../core/types";

/**
 * Statement-period overlap detection.
 *
 * The user uploads Jan–Mar in April, then Feb–Apr in May. February is in both
 * files, so every February row arrives twice. Nothing about an individual row
 * says "I am from an overlapping period" — only the document metadata does, so
 * this runs at upload time and hands the row-level dedupe a window of dates
 * that deserve extra scrutiny.
 *
 * This module reports; it never decides. An overlap is a reason to look harder
 * at those rows, not a reason to drop them: a genuinely new transaction can sit
 * inside an overlap window (the earlier statement was issued before it cleared).
 */

/** Structural minimum of a stored document. `StatementDocument` satisfies it. */
export interface ExistingPeriodDocument {
  id: string;
  provider?: Provider;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/** The document being uploaded. Has no id yet if it is not persisted. */
export interface NewPeriodDocument {
  id?: string | null;
  provider?: Provider;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface PeriodOverlap {
  /** Inclusive start of the contested window. */
  start: Date;
  /** Inclusive end of the contested window. */
  end: Date;
  /** Ids of the already-stored documents that cover this exact window. */
  documentIds: string[];
}

export interface PeriodOverlapOptions {
  /**
   * Only compare against documents from the same provider. On by default: a
   * bKash statement overlapping a bank statement in TIME is not a duplication
   * risk, since they describe different accounts. Turn off for pure date maths.
   */
  sameProviderOnly?: boolean;
}

function timeOf(value: Date): number {
  return new Date(value).getTime();
}

interface NormalisedRange {
  start: number;
  end: number;
}

/** Read a period, tolerating nulls, invalid dates and reversed start/end. */
function toRange(doc: NewPeriodDocument | ExistingPeriodDocument): NormalisedRange | null {
  if (doc.periodStart == null || doc.periodEnd == null) return null;

  const a = timeOf(doc.periodStart);
  const b = timeOf(doc.periodEnd);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/**
 * Windows where a new document's statement period collides with documents
 * already stored.
 *
 * Ranges are treated as INCLUSIVE on both ends, so a statement ending 31 Jan
 * and one starting 31 Jan overlap on a single instant — that day's rows really
 * do appear in both files. Entries covering the identical window are merged and
 * carry every contributing document id.
 *
 * Returns `null` (not `[]`) when there is nothing to worry about, so callers
 * can branch on truthiness.
 */
export function findPeriodOverlap(
  newDoc: NewPeriodDocument,
  existingDocs: readonly ExistingPeriodDocument[],
  options: PeriodOverlapOptions = {},
): PeriodOverlap[] | null {
  const { sameProviderOnly = true } = options;

  const incoming = toRange(newDoc);
  if (!incoming) return null;

  // Group by the exact contested window so one entry can name several files.
  const byWindow = new Map<string, { start: number; end: number; ids: Set<string> }>();

  for (const doc of existingDocs) {
    if (doc.id == null || doc.id === "") continue;
    // Re-checking a document against itself is not an overlap.
    if (newDoc.id != null && newDoc.id !== "" && doc.id === newDoc.id) continue;

    if (
      sameProviderOnly &&
      newDoc.provider != null &&
      doc.provider != null &&
      doc.provider !== newDoc.provider
    ) {
      continue;
    }

    const other = toRange(doc);
    if (!other) continue;

    const start = Math.max(incoming.start, other.start);
    const end = Math.min(incoming.end, other.end);
    if (start > end) continue;

    const key = `${start}:${end}`;
    const bucket = byWindow.get(key);
    if (bucket) {
      bucket.ids.add(doc.id);
    } else {
      byWindow.set(key, { start, end, ids: new Set([doc.id]) });
    }
  }

  if (byWindow.size === 0) return null;

  return [...byWindow.values()]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((bucket) => ({
      start: new Date(bucket.start),
      end: new Date(bucket.end),
      documentIds: [...bucket.ids].sort(),
    }));
}

/**
 * Does a transaction date fall inside any contested window? Rows that do should
 * be dedupe-checked with a wider net (the caller can pass a longer
 * `fuzzyWindowMs` or a lower similarity threshold for exactly these rows).
 */
export function isWithinOverlap(
  occurredAt: Date,
  overlaps: readonly PeriodOverlap[] | null,
): boolean {
  if (!overlaps || overlaps.length === 0) return false;

  const t = timeOf(occurredAt);
  if (!Number.isFinite(t)) return false;

  return overlaps.some(
    (window) => t >= timeOf(window.start) && t <= timeOf(window.end),
  );
}

/** Total contested days across all windows — a cheap severity signal for the UI. */
export function overlapDays(overlaps: readonly PeriodOverlap[] | null): number {
  if (!overlaps || overlaps.length === 0) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  let total = 0;
  for (const window of overlaps) {
    // Both bounds are inclusive, so a window is (end − start) + 1 days. Without
    // the +1 the commonest overlap of all — one statement ending on the day the
    // next begins — measures zero, and any caller gating on `> 0` skips exactly
    // the case it was written to catch.
    const span = (timeOf(window.end) - timeOf(window.start)) / dayMs + 1;
    total += Math.max(0, span);
  }
  return Math.round(total * 100) / 100;
}
