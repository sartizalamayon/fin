import { ArrowLeftRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { categoryLabel } from "@/lib/analytics/format";
import type { Category } from "@/lib/core/types";
import { cn } from "@/lib/utils";

export interface CategoryBadgeProps {
  category: Category | null;
  className?: string;
}

/**
 * Category label as ink on a neutral chip.
 *
 * Twelve categories cannot be given twelve colour-blind-safe hues, and the word
 * itself is unambiguous — so the badge carries the name, not a colour code. The
 * one exception is `transfer`, which gets an icon because it is the category
 * with a *rule* attached: those rows are visible here but excluded from every
 * total on the page, and the user needs a reason for the discrepancy.
 */
export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const isTransfer = category === "transfer";

  return (
    <Badge
      variant={isTransfer ? "secondary" : "outline"}
      className={cn("max-w-full truncate font-normal", className)}
      title={isTransfer ? "Own-account transfer — not counted as income or spending" : undefined}
    >
      {isTransfer ? (
        <ArrowLeftRight data-icon="inline-start" aria-hidden="true" />
      ) : null}
      {categoryLabel(category)}
    </Badge>
  );
}
