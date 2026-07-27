import { cn } from "@/lib/utils";

/**
 * Two-up figure grid. Two columns fit 375px comfortably; three do not once the
 * numbers carry a currency symbol and decimals.
 */
export function StatGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <dl className={cn("grid grid-cols-2 gap-3", className)}>{children}</dl>
  );
}

export function Stat({
  label,
  value,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "credit" | "debit";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card px-3 py-2.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums",
          tone === "credit" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
