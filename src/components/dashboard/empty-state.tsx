import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  /** Defaults to the upload flow — the only thing a brand-new user can do. */
  action?: { label: string; href: string } | null;
  className?: string;
}

/**
 * The zero-data state. A new user has no transactions, and an empty chart frame
 * looks broken rather than empty — so every component swaps in this panel and
 * points at the one action that fixes it.
 */
export function EmptyState({
  icon: Icon = Upload,
  title,
  description,
  action = { label: "Upload a statement", href: "/upload" },
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-4 py-8 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-[38ch] text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? (
        <Button
          size="lg"
          className="mt-1 min-h-11 px-4"
          render={<Link href={action.href} />}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
