"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/core/types";
import { categoryLabel } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

/**
 * Search and filter controls.
 *
 * Filters are URL state, not component state, so a filtered view is
 * shareable, survives a refresh, and works with the browser back button.
 *
 * The category row scrolls horizontally inside itself — twelve chips cannot fit
 * across 375px, and wrapping them would push the transaction list below the
 * fold on a phone.
 */
export function TransactionFilters({ className }: { className?: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const [query, setQuery] = React.useState(params.get("q") ?? "");
  const activeCategory = params.get("category");
  const activeDirection = params.get("direction");

  const update = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const search = next.toString();
      router.replace(search ? `/transactions?${search}` : "/transactions");
    },
    [params, router],
  );

  // Debounce so typing does not fire a navigation per keystroke.
  React.useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;

    const timer = setTimeout(() => update({ q: query || null }), 300);
    return () => clearTimeout(timer);
  }, [query, params, update]);

  const hasFilters = Boolean(query || activeCategory || activeDirection);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          inputMode="search"
          placeholder="Search description or counterparty"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search transactions"
          className="h-11 pl-9"
        />
      </div>

      <div className="flex gap-2">
        {(["credit", "debit"] as const).map((direction) => (
          <Button
            key={direction}
            type="button"
            size="sm"
            variant={activeDirection === direction ? "secondary" : "outline"}
            onClick={() =>
              update({
                direction: activeDirection === direction ? null : direction,
              })
            }
            className="h-10 flex-1"
          >
            {direction === "credit" ? "Money in" : "Money out"}
          </Button>
        ))}
      </div>

      {/* Horizontal scroll stays inside this strip; the page never moves. */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex w-max gap-2 pb-1">
          {CATEGORIES.map((category) => (
            <Button
              key={category}
              type="button"
              size="sm"
              variant={activeCategory === category ? "secondary" : "outline"}
              onClick={() =>
                update({
                  category: activeCategory === category ? null : category,
                })
              }
              className="h-10 shrink-0"
            >
              {categoryLabel(category)}
            </Button>
          ))}
        </div>
      </div>

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setQuery("");
            router.replace("/transactions");
          }}
          className="h-10 self-start"
        >
          <X className="size-4" aria-hidden />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
