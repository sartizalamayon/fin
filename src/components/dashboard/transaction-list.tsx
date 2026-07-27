"use client";

import { Receipt } from "lucide-react";

import { CategoryBadge } from "./category-badge";
import { EmptyState } from "./empty-state";
import { directionToneClass } from "./palette";
import { formatDayLabel, formatDirectionalMoney } from "@/lib/analytics/format";
import { isOwnTransfer } from "@/lib/analytics/aggregate";
import type { Transaction } from "@/lib/core/types";
import { cn } from "@/lib/utils";

/**
 * Transaction rows.
 *
 * A card list rather than a table: a table with six columns on a 375px screen
 * either scrolls sideways or shrinks its type past readability, and the same
 * information reads fine stacked. Each row is a comfortable tap target.
 *
 * Own-account transfers are shown here but excluded from every total on the
 * page — the badge is what explains the discrepancy to the user.
 */

export interface TransactionListProps {
  transactions: readonly Transaction[];
  currency?: string;
  title?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function TransactionList({
  transactions,
  currency = "BDT",
  title = "Recent activity",
  emptyTitle = "No transactions yet",
  emptyDescription = "Upload a bank or bKash statement to get started.",
  className,
}: TransactionListProps) {
  return (
    <section className={cn("rounded-xl border p-4", className)}>
      <h2 className="text-sm font-medium">{title}</h2>

      {transactions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={emptyTitle}
          description={emptyDescription}
          className="mt-3 border-0 px-0 py-6"
        />
      ) : (
        <ul className="mt-1 divide-y">
          {transactions.map((txn) => (
            <li
              key={txn.id}
              className="flex items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {txn.counterparty || txn.description || "Transaction"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs text-muted-foreground">
                    {formatDayLabel(txn.occurredAt)}
                  </span>
                  <CategoryBadge
                    category={isOwnTransfer(txn) ? "transfer" : txn.category}
                  />
                </div>
              </div>

              <span
                className={cn(
                  "shrink-0 text-sm font-medium tabular-nums",
                  directionToneClass(txn.direction),
                )}
              >
                {formatDirectionalMoney(txn.amountMinor, txn.direction, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
