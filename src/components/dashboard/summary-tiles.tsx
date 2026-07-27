import { ArrowDownLeft, ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SummaryStats } from "@/lib/analytics/aggregate";
import { formatMoney } from "@/lib/core/money";
import { formatSignedMoney } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

import { MONEY_IN_TEXT, MONEY_OUT_TEXT, netToneClass } from "./palette";

export interface SummaryTilesProps {
  stats: SummaryStats;
  currency?: string;
  /** e.g. "July 2026" — names the window the numbers cover. */
  monthLabel?: string;
  /**
   * Own-account transfers excluded from these totals. Shown as a footnote so
   * the numbers can be reconciled against the transaction list below.
   */
  transferCount?: number;
  className?: string;
}

/**
 * In / out / net for one month.
 *
 * Mobile layout is a 2-column grid with net spanning the full width as the
 * hero — four numbers across a 375px screen would leave ~85px per tile, which
 * cannot hold "BDT 65,000" at a readable size. On `sm` and up the same grid
 * widens to four columns and everything sits on one row.
 */
export function SummaryTiles({
  stats,
  currency = "BDT",
  monthLabel,
  transferCount = 0,
  className,
}: SummaryTilesProps) {
  const NetIcon = stats.netMinor < 0 ? TrendingDown : TrendingUp;

  return (
    <section
      aria-label={monthLabel ? `Summary for ${monthLabel}` : "Summary"}
      className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}
    >
      <Card className="col-span-2">
        <CardContent className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <NetIcon
              className={cn("size-3.5", netToneClass(stats.netMinor))}
              aria-hidden="true"
            />
            Net {monthLabel ? `· ${monthLabel}` : ""}
          </p>
          <p
            className={cn(
              "font-mono text-2xl leading-tight font-semibold tabular-nums sm:text-3xl",
              netToneClass(stats.netMinor),
            )}
          >
            {formatSignedMoney(stats.netMinor, currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            {stats.txnCount} transaction{stats.txnCount === 1 ? "" : "s"}
            {stats.avgTxnMinor > 0
              ? ` · avg spend ${formatMoney(stats.avgTxnMinor, currency, { compact: true })}`
              : ""}
          </p>
          {transferCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Excludes {transferCount} own-account transfer
              {transferCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Tile
        label="Money in"
        icon={<ArrowDownLeft className={cn("size-3.5", MONEY_IN_TEXT)} aria-hidden="true" />}
        value={formatMoney(stats.incomeMinor, currency, { compact: true })}
        toneClass={MONEY_IN_TEXT}
      />
      <Tile
        label="Money out"
        icon={<ArrowUpRight className={cn("size-3.5", MONEY_OUT_TEXT)} aria-hidden="true" />}
        value={formatMoney(stats.expenseMinor, currency, { compact: true })}
        toneClass={MONEY_OUT_TEXT}
      />
    </section>
  );
}

function Tile({
  label,
  value,
  icon,
  toneClass,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  toneClass: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {icon}
          {label}
        </p>
        <p
          className={cn(
            "font-mono text-lg leading-tight font-semibold tabular-nums break-all",
            toneClass,
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export function SummaryTilesSkeleton({ className }: { className?: string }) {
  return (
    <section
      aria-hidden="true"
      data-slot="summary-tiles-skeleton"
      className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}
    >
      <Card className="col-span-2">
        <CardContent className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
      {[0, 1].map((index) => (
        <Card key={index}>
          <CardContent className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-24" />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
