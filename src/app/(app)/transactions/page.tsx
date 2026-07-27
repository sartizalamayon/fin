import type { Metadata } from "next";

import { TransactionList } from "@/components/dashboard/transaction-list";
import { TransactionFilters } from "@/components/dashboard/transaction-filters";
import type { Category, Direction, Transaction } from "@/lib/core/types";
import { listTransactions } from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity — fin." };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    direction?: string;
    document?: string;
  }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;

  let transactions: Transaction[] = [];
  let total = 0;

  if (user) {
    const page = await listTransactions({
      userId: user.id,
      limit: PAGE_SIZE,
      search: params.q,
      categories: params.category ? [params.category as Category] : undefined,
      direction: params.direction as Direction | undefined,
      documentId: params.document,
    });
    transactions = page.transactions;
    total = page.total;
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {total === 0
            ? "Nothing here yet"
            : `${total} transaction${total === 1 ? "" : "s"}`}
        </p>
      </header>

      <TransactionFilters />

      <TransactionList
        transactions={transactions}
        title={`Showing ${transactions.length}`}
        emptyTitle="No matching transactions"
        emptyDescription="Try clearing the filters, or import another statement."
      />
    </div>
  );
}
