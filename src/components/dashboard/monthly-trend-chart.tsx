"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "./empty-state";
import { MONEY_IN, MONEY_OUT } from "./palette";
import { formatCompactMoney, shortMonthLabel } from "@/lib/analytics/format";
import type { MonthlyTotal } from "@/lib/analytics/aggregate";
import { cn } from "@/lib/utils";
import { ChartNoAxesCombined } from "lucide-react";

/**
 * Money in versus money out, month by month.
 *
 * Grouped bars rather than a line: these are discrete monthly totals, not a
 * continuous signal, and a line implies interpolation between months that does
 * not exist.
 *
 * On a phone, a year of paired bars would be about 12px per bar and unreadable,
 * so the plot is given a minimum width per month and allowed to scroll inside
 * its own container. The page itself never scrolls sideways.
 */

const MIN_MONTH_WIDTH_PX = 64;

const CHART_CONFIG = {
  incomeMinor: { label: "In", theme: { light: MONEY_IN.light, dark: MONEY_IN.dark } },
  expenseMinor: { label: "Out", theme: { light: MONEY_OUT.light, dark: MONEY_OUT.dark } },
} satisfies ChartConfig;

export interface MonthlyTrendChartProps {
  data: readonly MonthlyTotal[];
  currency?: string;
  className?: string;
}

export function MonthlyTrendChart({
  data,
  currency = "BDT",
  className,
}: MonthlyTrendChartProps) {
  const hasData = data.some(
    (month) => month.incomeMinor !== 0 || month.expenseMinor !== 0,
  );

  const chartData = React.useMemo(
    () =>
      data.map((month) => ({
        ...month,
        label: shortMonthLabel(month.month),
      })),
    [data],
  );

  if (!hasData) {
    return (
      <section className={cn("rounded-xl border p-4", className)}>
        <h2 className="text-sm font-medium">Month by month</h2>
        <EmptyState
          icon={ChartNoAxesCombined}
          title="No monthly totals yet"
          description="Import a statement and your income and spending will chart here."
          className="mt-3 border-0 px-0 py-6"
        />
      </section>
    );
  }

  return (
    <section className={cn("rounded-xl border p-4", className)}>
      <h2 className="text-sm font-medium">Month by month</h2>

      {/* Only this container scrolls; the page must not. */}
      <div className="-mx-1 mt-3 overflow-x-auto px-1">
        <div
          style={{ minWidth: `${chartData.length * MIN_MONTH_WIDTH_PX}px` }}
          className="w-full"
        >
          <ChartContainer config={CHART_CONFIG} className="h-56 w-full md:h-64">
            <BarChart data={chartData} margin={{ left: 4, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={11}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                fontSize={11}
                tickFormatter={(value: number) =>
                  formatCompactMoney(value, currency)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) =>
                      formatCompactMoney(Number(value), currency)
                    }
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="incomeMinor" fill="var(--color-incomeMinor)" radius={3} />
              <Bar dataKey="expenseMinor" fill="var(--color-expenseMinor)" radius={3} />
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </section>
  );
}
