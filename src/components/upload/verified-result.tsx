"use client";

import { CircleCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/core/money";
import type { Currency, ExtractedRow, ReconcileResult } from "@/lib/core/types";
import { formatPeriod } from "./format";
import { Stat, StatGrid } from "./stat-grid";
import { ThumbZone } from "./thumb-zone";
import { TransactionPreviewList } from "./transaction-preview-list";

/**
 * The payoff: the import is proven, not merely finished.
 *
 * "Verified" is a specific claim and the copy says exactly what it means —
 * the extracted rows sum to the statement's own closing balance — because a
 * green tick that means nothing in particular is worse than no tick at all.
 */
export function VerifiedResult({
  filename,
  currency = "BDT",
  periodStart,
  periodEnd,
  reconcile,
  rows,
  previewLimit = 5,
  onViewTransactions,
  onUploadAnother,
}: {
  filename: string;
  currency?: Currency;
  periodStart: Date | null;
  periodEnd: Date | null;
  reconcile: ReconcileResult;
  rows: ExtractedRow[];
  previewLimit?: number;
  onViewTransactions: () => void;
  onUploadAnother: () => void;
}) {
  const period = formatPeriod(periodStart, periodEnd);
  const closing = reconcile.closingBalanceMinor;

  return (
    <div className="flex flex-col">
      <div
        role="status"
        data-testid="verified-banner"
        className="flex items-start gap-3 rounded-xl border border-emerald-600/30 bg-emerald-50 px-4 py-3.5 dark:bg-emerald-950/40"
      >
        <CircleCheck
          className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="font-semibold text-emerald-900 dark:text-emerald-100">
            Verified against your closing balance
          </p>
          <p className="mt-1 text-sm leading-relaxed text-emerald-900/80 dark:text-emerald-100/80">
            {closing === null ? (
              <>
                All {reconcile.rowCount} transactions add up exactly to the
                statement&rsquo;s own closing balance — nothing is missing and
                nothing was invented.
              </>
            ) : (
              <>
                All {reconcile.rowCount} transactions add up to exactly{" "}
                {formatMoney(closing, currency)}, the closing balance printed on
                the statement — so nothing is missing and nothing was invented.
              </>
            )}
          </p>
        </div>
      </div>

      <h1 className="mt-6 text-xl font-semibold tracking-tight">
        {reconcile.rowCount}{" "}
        {reconcile.rowCount === 1 ? "transaction" : "transactions"} imported
      </h1>
      <p className="mt-1 truncate text-sm text-muted-foreground">{filename}</p>

      <StatGrid className="mt-4">
        <Stat label="Period" value={period ?? "Not stated"} />
        <Stat
          label="Transactions"
          value={reconcile.rowCount}
        />
        <Stat
          label="Money in"
          value={`+${formatMoney(reconcile.totalCreditsMinor, currency)}`}
          tone="credit"
        />
        <Stat
          label="Money out"
          value={`−${formatMoney(reconcile.totalDebitsMinor, currency)}`}
        />
        {reconcile.totalFeesMinor > 0 ? (
          <Stat
            label="Fees charged"
            value={formatMoney(reconcile.totalFeesMinor, currency)}
          />
        ) : null}
        {closing !== null ? (
          <Stat
            label="Closing balance"
            value={formatMoney(closing, currency)}
          />
        ) : null}
      </StatGrid>

      <h2 className="mt-6 text-sm font-medium">What we found</h2>
      <TransactionPreviewList
        rows={rows}
        currency={currency}
        limit={previewLimit}
        className="mt-2"
      />

      <ThumbZone>
        <Button
          type="button"
          size="lg"
          onClick={onViewTransactions}
          className="h-12 w-full text-base"
        >
          See my transactions
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onUploadAnother}
          className="h-11 w-full"
        >
          <Upload className="size-4" aria-hidden />
          Upload another statement
        </Button>
      </ThumbZone>
    </div>
  );
}
