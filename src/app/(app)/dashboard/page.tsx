import type { Metadata } from "next";
import Link from "next/link";

import { SummaryTiles } from "@/components/dashboard/summary-tiles";
import { MonthlyTrendChart } from "@/components/dashboard/monthly-trend-chart";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { TransactionList } from "@/components/dashboard/transaction-list";
import { buttonVariants } from "@/components/ui/button";
import {
  categoryTotals,
  monthlyTotals,
  summaryStats,
  trailingMonths,
  availableMonths,
  spendableTransactions,
} from "@/lib/analytics/aggregate";
import { formatMonthLabel } from "@/lib/core/dates";
import type { Transaction } from "@/lib/core/types";
import { listTransactions } from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard — fin." };
export const dynamic = "force-dynamic";

/**
 * The dashboard reads through the server-side query layer, which filters on
 * user_id. Aggregates deliberately exclude own-account transfers — a bank to
 * bKash move is not income and not spending, and counting it would inflate
 * both figures at once.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCurrentUser();
  const { month: requestedMonth } = await searchParams;

  let transactions: Transaction[] = [];
  if (user) {
    const page = await listTransactions({ userId: user.id, limit: 500 });
    transactions = page.transactions;
  }

  const months = availableMonths(transactions);
  const month = requestedMonth ?? months[months.length - 1];

  const stats = summaryStats(transactions, month ? { month } : {});
  const trend = trailingMonths(monthlyTotals(transactions), 12);
  const categories = categoryTotals(transactions, { month, limit: 8 });

  const transferCount =
    transactions.length - spendableTransactions(transactions).length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          {month ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {formatMonthLabel(month)}
            </p>
          ) : null}
        </div>
        <Link
          href="/upload"
          className={buttonVariants({ size: "sm", className: "h-10" })}
        >
          Upload
        </Link>
      </header>

      <SummaryTiles
        stats={stats}
        monthLabel={month ? formatMonthLabel(month) : undefined}
        transferCount={transferCount}
      />

      <MonthlyTrendChart data={trend} />

      <CategoryBreakdown data={categories} />

      <TransactionList transactions={transactions.slice(0, 8)} />

      {transactions.length > 8 ? (
        <Link
          href="/transactions"
          className={buttonVariants({
            variant: "outline",
            className: "h-11 w-full",
          })}
        >
          See all {transactions.length} transactions
        </Link>
      ) : null}
    </div>
  );
}
