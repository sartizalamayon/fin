"use client";

import { Check, LoaderCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const PROCESSING_STAGES = [
  {
    id: "decrypting",
    label: "Decrypting",
    detail: "Unlocking the PDF with the password you gave.",
  },
  {
    id: "reading",
    label: "Reading",
    detail: "Pulling the text out of every page.",
  },
  {
    id: "extracting",
    label: "Extracting transactions",
    detail: "Turning statement lines into dated, signed amounts.",
  },
  {
    id: "verifying",
    label: "Verifying balances",
    detail: "Adding every row up against the statement's closing balance.",
  },
] as const;

export type ProcessingStage = (typeof PROCESSING_STAGES)[number]["id"];

/**
 * Processing state.
 *
 * The labels name the four things that actually happen, in order, so a slow
 * import is legible rather than suspicious — "Verifying balances" for eight
 * seconds tells the user something specific and true. Unencrypted files skip
 * the decrypt step instead of pretending to run it.
 */
export function ProcessingProgress({
  filename,
  stage,
  encrypted = true,
}: {
  filename: string;
  stage: ProcessingStage;
  /** False when no password was needed, which drops the decrypt step. */
  encrypted?: boolean;
}) {
  const stages = PROCESSING_STAGES.filter(
    (item) => encrypted || item.id !== "decrypting",
  );
  const activeIndex = Math.max(
    0,
    stages.findIndex((item) => item.id === stage),
  );
  // Sits mid-step rather than at the boundary: the active step is underway.
  const percent = Math.round(((activeIndex + 0.5) / stages.length) * 100);

  return (
    <div className="flex flex-col">
      <h1 className="text-2xl font-semibold tracking-tight">
        Reading your statement
      </h1>
      <p className="mt-1.5 truncate text-sm text-muted-foreground">
        {filename}
      </p>

      <Progress
        value={percent}
        aria-label="Import progress"
        className="mt-6"
      />

      <ol className="mt-6 space-y-4" aria-live="polite">
        {stages.map((item, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;
          return (
            <li
              key={item.id}
              data-testid={`stage-${item.id}`}
              data-state={isDone ? "done" : isActive ? "active" : "pending"}
              className="flex items-start gap-3"
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                  isDone && "border-emerald-600 bg-emerald-600 text-white",
                  isActive && "border-primary text-primary",
                  !isDone && !isActive && "border-border text-muted-foreground",
                )}
              >
                {isDone ? (
                  <Check className="size-3.5" aria-hidden />
                ) : isActive ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <span className="text-[11px] tabular-nums">{index + 1}</span>
                )}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm font-medium",
                    !isDone && !isActive && "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
                {isActive ? (
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {item.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
        This usually takes under a minute. Keep this screen open — the file is
        held in memory only, so leaving means starting again.
      </p>
    </div>
  );
}
