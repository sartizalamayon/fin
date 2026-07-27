"use client";

import * as React from "react";
import { ListChecks, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/core/money";
import type { Currency, ExtractedRow, ReconcileResult } from "@/lib/core/types";
import { Stat, StatGrid } from "./stat-grid";
import { ThumbZone } from "./thumb-zone";
import { TransactionPreviewList } from "./transaction-preview-list";

/**
 * Reconciliation failed.
 *
 * This is deliberately not an error screen and deliberately not a success
 * screen. The extraction worked; the arithmetic did not agree with the
 * statement, which means at least one row is wrong and we do not know which.
 * So nothing is written to the ledger, the size of the gap is stated in money
 * rather than in jargon, and the only two exits are "look at the rows" and
 * "throw this import away". There is no "import anyway" button: unverified
 * money data silently entering the ledger is the one outcome this whole app
 * exists to prevent.
 */
export function ReconcileFailed({
  filename,
  currency = "BDT",
  reconcile,
  rows,
  suspectRowIndexes = [],
  onDiscard,
  onReviewRows,
  isDiscarding = false,
}: {
  filename: string;
  currency?: Currency;
  reconcile: ReconcileResult;
  rows: ExtractedRow[];
  /** Indexes into `rows` the pipeline flagged. Empty when it named none. */
  suspectRowIndexes?: number[];
  onDiscard: () => void;
  /** Fired when the user opens the full row list. */
  onReviewRows?: () => void;
  isDiscarding?: boolean;
}) {
  const [reviewing, setReviewing] = React.useState(false);

  const gap = Math.abs(reconcile.deltaMinor);
  // delta = computed − declared, so a positive gap means we counted too much.
  const direction = reconcile.deltaMinor > 0 ? "more" : "less";
  const hasSuspects = suspectRowIndexes.length > 0;

  return (
    <div className="flex flex-col">
      <div
        role="alert"
        data-testid="reconcile-failed-banner"
        className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-3.5 dark:bg-amber-950/40"
      >
        <TriangleAlert
          className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="font-semibold text-amber-900 dark:text-amber-100">
            These transactions don&rsquo;t add up
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/80 dark:text-amber-100/80">
            Nothing has been added to your ledger. The rows we extracted total{" "}
            <span className="font-semibold" data-testid="discrepancy-amount">
              {formatMoney(gap, currency)}
            </span>{" "}
            {direction} than the closing balance your statement declares, so at
            least one row is wrong and we cannot tell which.
          </p>
        </div>
      </div>

      <p className="mt-4 truncate text-sm text-muted-foreground">{filename}</p>

      <StatGrid className="mt-4">
        <Stat
          label="Rows add up to"
          value={
            reconcile.computedClosingMinor === null
              ? "Unknown"
              : formatMoney(reconcile.computedClosingMinor, currency)
          }
        />
        <Stat
          label="Statement says"
          value={
            reconcile.closingBalanceMinor === null
              ? "Not stated"
              : formatMoney(reconcile.closingBalanceMinor, currency)
          }
        />
        <Stat
          label="Difference"
          value={`${reconcile.deltaMinor > 0 ? "+" : "−"}${formatMoney(gap, currency)}`}
          className="col-span-2 border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20"
        />
      </StatGrid>

      {reconcile.message ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {reconcile.message}
        </p>
      ) : null}

      {hasSuspects ? (
        <section className="mt-6" data-testid="suspect-rows">
          <h2 className="text-sm font-medium">
            {suspectRowIndexes.length === 1
              ? "This row looks wrong"
              : `${suspectRowIndexes.length} rows look wrong`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These are the lines the reader was least sure about. Compare them
            with the PDF before you decide.
          </p>
          <TransactionPreviewList
            className="mt-2"
            currency={currency}
            rows={suspectRowIndexes
              .filter((index) => index >= 0 && index < rows.length)
              .map((index) => rows[index])}
            suspectIndexes={suspectRowIndexes.map((_, index) => index)}
          />
        </section>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          The reader could not point at a specific line, so check the whole
          statement — a skipped page or a misread amount both look like this.
        </p>
      )}

      {reviewing ? (
        <section className="mt-6" data-testid="all-rows">
          <h2 className="text-sm font-medium">
            All {rows.length} extracted {rows.length === 1 ? "row" : "rows"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing here has been saved. If the statement is fine and this list
            is not, the reader misread it — discard and try again.
          </p>
          <TransactionPreviewList
            className="mt-2"
            currency={currency}
            rows={rows}
            suspectIndexes={suspectRowIndexes}
          />
        </section>
      ) : null}

      <ThumbZone>
        {reviewing ? null : (
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => {
              setReviewing(true);
              onReviewRows?.();
            }}
            className="h-12 w-full text-base"
          >
            <ListChecks className="size-4" aria-hidden />
            Review the {rows.length} {rows.length === 1 ? "row" : "rows"}
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          variant="destructive"
          onClick={onDiscard}
          disabled={isDiscarding}
          className="h-12 w-full text-base"
        >
          <Trash2 className="size-4" aria-hidden />
          Discard this import
        </Button>
      </ThumbZone>
    </div>
  );
}
