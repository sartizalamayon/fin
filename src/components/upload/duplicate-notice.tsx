"use client";

import Link from "next/link";
import { FileText, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatFullDate, formatPeriod } from "./format";
import { ThumbZone } from "./thumb-zone";

/**
 * The same file, again.
 *
 * Caught on the file hash before any LLM call, so this costs the user nothing.
 * The point is to say when it happened and offer the import they already have,
 * rather than leaving them wondering whether it worked the first time.
 */
export function DuplicateNotice({
  filename,
  uploadedAt,
  documentHref,
  rowCount,
  periodStart = null,
  periodEnd = null,
  onUploadAnother,
}: {
  filename: string;
  uploadedAt: Date;
  documentHref: string;
  rowCount?: number;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  onUploadAnother: () => void;
}) {
  const period = formatPeriod(periodStart, periodEnd);

  return (
    <div className="flex flex-col">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <FileText className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Already imported
      </h1>
      <p
        className="mt-1.5 text-sm leading-relaxed text-muted-foreground"
        data-testid="duplicate-message"
      >
        You already uploaded this statement on {formatFullDate(uploadedAt)}.
        Nothing was imported twice.
      </p>

      <div className="mt-6 rounded-lg border bg-card px-4 py-3">
        <p className="truncate text-sm font-medium">{filename}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {typeof rowCount === "number"
            ? `${rowCount} ${rowCount === 1 ? "transaction" : "transactions"}`
            : "Imported"}
          {period ? ` · ${period}` : ""}
        </p>
      </div>

      <ThumbZone>
        <Link
          href={documentHref}
          className={cn(
            buttonVariants({ size: "lg" }),
            "h-12 w-full text-base",
          )}
        >
          See this import
        </Link>
        <Button
          type="button"
          variant="ghost"
          onClick={onUploadAnother}
          className="h-11 w-full"
        >
          <Upload className="size-4" aria-hidden />
          Upload a different statement
        </Button>
      </ThumbZone>
    </div>
  );
}
