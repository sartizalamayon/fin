"use client";

import { PieChart } from "lucide-react";

import { EmptyState } from "./empty-state";
import { formatShare, categoryLabel } from "@/lib/analytics/format";
import { formatMoney } from "@/lib/core/money";
import type { CategoryTotal } from "@/lib/analytics/aggregate";
import { cn } from "@/lib/utils";

/**
 * Where the money went, by category.
 *
 * Horizontal bars, not a donut. On a 375px screen a donut with twelve slices
 * needs an external legend to be readable at all, which means the eye has to
 * travel between the shape and the labels to answer any question. Bars put the
 * label, the amount and the magnitude on one line — and they stay legible when
 * one category dominates, where a donut collapses into a single arc.
 */

export interface CategoryBreakdownProps {
  data: readonly CategoryTotal[];
  currency?: string;
  className?: string;
}

export function CategoryBreakdown({
  data,
  currency = "BDT",
  className,
}: CategoryBreakdownProps) {
  const rows = data.filter((row) => row.totalMinor > 0);

  return (
    <section className={cn("rounded-xl border p-4", className)}>
      <h2 className="text-sm font-medium">Where it went</h2>

      {rows.length === 0 ? (
        <EmptyState
          icon={PieChart}
          title="Nothing categorised yet"
          description="Once you import spending, it will break down by category here."
          className="mt-3 border-0 px-0 py-6"
        />
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.category}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {categoryLabel(row.category)}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatMoney(row.totalMinor, currency, { compact: true })}
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-2">
                <div
                  className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${categoryLabel(row.category)}: ${formatShare(row.share)} of spending`}
                >
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: `${Math.max(row.share * 100, 1.5)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {formatShare(row.share)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
