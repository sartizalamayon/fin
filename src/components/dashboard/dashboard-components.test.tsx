import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { SummaryTiles } from "./summary-tiles";
import { CategoryBreakdown } from "./category-breakdown";
import { TransactionList } from "./transaction-list";
import { MonthlyTrendChart } from "./monthly-trend-chart";
import { EmptyState } from "./empty-state";
import {
  categoryTotals,
  monthlyTotals,
  summaryStats,
} from "@/lib/analytics/aggregate";
import { DEMO_TRANSACTIONS, NO_TRANSACTIONS } from "./__fixtures__";
import type { Transaction } from "@/lib/core/types";

/**
 * Dashboard rendering.
 *
 * A new user sees zero of everything, so every component has to look
 * deliberately empty rather than broken — that state is as much a feature as
 * the populated one.
 */

const transfer = DEMO_TRANSACTIONS.find(
  (t) => t.transferPairId !== null || t.category === "transfer",
);

describe("SummaryTiles", () => {
  it("shows income, spending and net for the month", () => {
    const stats = summaryStats(DEMO_TRANSACTIONS, { month: "2026-07" });
    render(<SummaryTiles stats={stats} monthLabel="July 2026" />);

    expect(screen.getByLabelText(/summary for july 2026/i)).toBeVisible();
  });

  it("renders zeros for a month with no activity, not a blank", () => {
    const stats = summaryStats(NO_TRANSACTIONS, {});
    render(<SummaryTiles stats={stats} />);

    expect(screen.getAllByText(/৳|BDT|0/).length).toBeGreaterThan(0);
  });

  it("footnotes the transfers it left out of the totals", () => {
    // The user can see transfer rows in the list below, so the totals need to
    // explain why they do not include them.
    const stats = summaryStats(DEMO_TRANSACTIONS, { month: "2026-07" });
    render(<SummaryTiles stats={stats} monthLabel="July 2026" transferCount={2} />);

    expect(screen.getByText(/transfer/i)).toBeVisible();
  });

  it("says nothing about transfers when there are none", () => {
    const stats = summaryStats(DEMO_TRANSACTIONS, { month: "2026-07" });
    render(<SummaryTiles stats={stats} transferCount={0} />);

    expect(screen.queryByText(/excluded/i)).not.toBeInTheDocument();
  });
});

describe("CategoryBreakdown", () => {
  it("lists categories with their share", () => {
    const data = categoryTotals(DEMO_TRANSACTIONS, { month: "2026-07" });
    render(<CategoryBreakdown data={data} />);

    expect(screen.getByRole("heading", { name: /where it went/i })).toBeVisible();
    expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
  });

  it("labels each bar for assistive tech, since the bar itself is decorative", () => {
    const data = categoryTotals(DEMO_TRANSACTIONS, { month: "2026-07" });
    render(<CategoryBreakdown data={data} />);

    const bars = screen.getAllByRole("img");
    expect(bars[0]).toHaveAccessibleName(/% of spending|of spending/i);
  });

  it("shows guidance instead of an empty frame", () => {
    render(<CategoryBreakdown data={[]} />);
    expect(screen.getByText(/nothing categorised yet/i)).toBeVisible();
  });

  it("hides categories that netted to zero", () => {
    render(
      <CategoryBreakdown
        data={[
          { category: "food", totalMinor: 50_000, count: 2, share: 1 },
          { category: "bills", totalMinor: 0, count: 0, share: 0 },
        ]}
      />,
    );

    expect(screen.getByText(/food/i)).toBeVisible();
    expect(screen.queryByText(/bills/i)).not.toBeInTheDocument();
  });
});

describe("TransactionList", () => {
  it("renders one row per transaction", () => {
    const rows = DEMO_TRANSACTIONS.slice(0, 5);
    render(<TransactionList transactions={rows} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
  });

  it("shows the counterparty and the amount together", () => {
    const [first] = DEMO_TRANSACTIONS;
    render(<TransactionList transactions={[first]} />);

    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent(
      new RegExp(first.counterparty ?? first.description, "i"),
    );
  });

  it("marks an own-account transfer, which the totals exclude", () => {
    // Without the badge the user cannot reconcile the list against the tiles.
    if (!transfer) return;
    render(<TransactionList transactions={[transfer]} />);

    expect(screen.getByRole("listitem")).toHaveTextContent(/transfer/i);
  });

  it("shows guidance for a brand-new user", () => {
    render(<TransactionList transactions={[]} />);

    expect(screen.getByText(/no transactions yet/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /upload/i })).toHaveAttribute(
      "href",
      "/upload",
    );
  });

  it("accepts custom empty copy for a filtered view", () => {
    render(
      <TransactionList
        transactions={[]}
        emptyTitle="No matching transactions"
        emptyDescription="Try clearing the filters."
      />,
    );

    expect(screen.getByText(/no matching transactions/i)).toBeVisible();
  });
});

describe("MonthlyTrendChart", () => {
  it("shows guidance rather than an empty chart frame", () => {
    render(<MonthlyTrendChart data={[]} />);
    expect(screen.getByText(/no monthly totals yet/i)).toBeVisible();
  });

  it("treats all-zero months as no data", () => {
    // Gap-filling produces zero months; a chart of nothing but zeros reads as
    // broken, so it should show the same guidance.
    render(
      <MonthlyTrendChart
        data={[
          { month: "2026-06", incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
          { month: "2026-07", incomeMinor: 0, expenseMinor: 0, netMinor: 0 },
        ]}
      />,
    );

    expect(screen.getByText(/no monthly totals yet/i)).toBeVisible();
  });

  it("renders the chart once there is activity", () => {
    const data = monthlyTotals(DEMO_TRANSACTIONS);
    render(<MonthlyTrendChart data={data} />);

    expect(screen.getByRole("heading", { name: /month by month/i })).toBeVisible();
    expect(screen.queryByText(/no monthly totals yet/i)).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("points at the one action that fixes it", () => {
    render(<EmptyState title="Nothing here" description="Import something." />);

    expect(screen.getByRole("link", { name: /upload a statement/i })).toHaveAttribute(
      "href",
      "/upload",
    );
  });

  it("can omit the action where none applies", () => {
    render(
      <EmptyState title="Nothing here" description="Import something." action={null} />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("money is never rendered from a float", () => {
  it("shows exact taka for awkward poisha values", () => {
    // 1234.56 via parseFloat * 100 is 123455.99999999999; if any of that leaks
    // into display the user sees a wrong figure with no clue why.
    const rows: Transaction[] = [
      { ...DEMO_TRANSACTIONS[0], amountMinor: 123_456, direction: "debit" },
    ];
    render(<TransactionList transactions={rows} />);

    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/1,234\.56/)).toBeVisible();
  });
});
