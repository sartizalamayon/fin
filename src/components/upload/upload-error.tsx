"use client";

import Link from "next/link";
import { CircleAlert, KeyRound, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UploadErrorCode } from "./contract";
import { ThumbZone } from "./thumb-zone";

/**
 * Something went wrong before we had any numbers to show.
 *
 * Distinct from `ReconcileFailed`, which is not an error — that one has data
 * and a decision to make. This one only ever has a reason and a retry. A
 * missing API key is called out separately because it is the one cause the
 * user can fix in thirty seconds.
 */
export function UploadError({
  code,
  message,
  onRetry,
}: {
  code: UploadErrorCode;
  message: string;
  onRetry: () => void;
}) {
  const needsKey = code === "no_key" || code === "unauthorized";

  return (
    <div className="flex flex-col">
      <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        {needsKey ? (
          <KeyRound className="size-5" aria-hidden />
        ) : (
          <CircleAlert className="size-5" aria-hidden />
        )}
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {needsKey ? "No API key yet" : "That didn’t work"}
      </h1>
      <p role="alert" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>

      <ThumbZone>
        {needsKey ? (
          <Link
            href="/onboarding"
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-12 w-full text-base",
            )}
          >
            Add your Groq key
          </Link>
        ) : null}
        <Button
          type="button"
          size="lg"
          variant={needsKey ? "ghost" : "default"}
          onClick={onRetry}
          className={cn("w-full text-base", needsKey ? "h-11" : "h-12")}
        >
          <RefreshCw className="size-4" aria-hidden />
          Try another file
        </Button>
      </ThumbZone>
    </div>
  );
}
