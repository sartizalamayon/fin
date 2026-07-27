import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/core/money";
import type { Currency, ExtractedRow } from "@/lib/core/types";
import { formatDay } from "./format";

/**
 * The extracted rows, as a list rather than a table.
 *
 * A 6-column table cannot fit 375px without horizontal scrolling, and money
 * data that scrolls sideways is money data nobody checks. Each row is a stacked
 * block: what it was, when, and how much — with the amount right-aligned so the
 * column of figures still scans vertically.
 */
export function TransactionPreviewList({
  rows,
  currency = "BDT",
  limit,
  suspectIndexes = [],
  className,
}: {
  rows: ExtractedRow[];
  currency?: Currency;
  /** Show only the first N rows; omit to show all. */
  limit?: number;
  /** Indexes (into `rows`) the pipeline flagged as unreliable. */
  suspectIndexes?: number[];
  className?: string;
}) {
  const shown = typeof limit === "number" ? rows.slice(0, limit) : rows;
  const hidden = rows.length - shown.length;
  const suspect = new Set(suspectIndexes);

  if (rows.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        No transactions were found in this statement.
      </p>
    );
  }

  return (
    <div className={className}>
      <ul className="divide-y rounded-lg border" data-testid="transaction-preview-list">
        {shown.map((row, index) => {
          const isSuspect = suspect.has(index);
          const isCredit = row.direction === "credit";
          return (
            <li
              key={`${row.refId ?? row.rawText}-${index}`}
              data-testid="transaction-row"
              data-suspect={isSuspect || undefined}
              className={cn(
                "flex items-start justify-between gap-3 px-3 py-3",
                isSuspect && "bg-amber-50 dark:bg-amber-950/30",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {row.counterparty ?? row.description}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {formatDay(row.occurredAt)}
                  {row.counterparty ? ` · ${row.description}` : ""}
                  {row.refId ? ` · ${row.refId}` : ""}
                </p>
                {isSuspect ? (
                  <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    Check this row
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    isCredit
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-foreground",
                  )}
                >
                  {isCredit ? "+" : "−"}
                  {formatMoney(row.amountMinor, currency)}
                </p>
                {row.feeMinor > 0 ? (
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    fee {formatMoney(row.feeMinor, currency)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          and {hidden} more {hidden === 1 ? "transaction" : "transactions"}
        </p>
      ) : null}
    </div>
  );
}
