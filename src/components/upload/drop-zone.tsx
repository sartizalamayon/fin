"use client";

import * as React from "react";
import { CircleAlert, FileText, Landmark, Smartphone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Provider } from "@/lib/core/types";
import { PROVIDER_META, UPLOADABLE_PROVIDERS } from "./provider-meta";
import { ThumbZone } from "./thumb-zone";

const PDF_EXTENSION = /\.pdf$/i;

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || PDF_EXTENSION.test(file.name);
}

/**
 * Idle state: pick a statement.
 *
 * On a phone this is not really a drop zone — it is a very large tap target
 * that opens the file picker. Drag-and-drop is layered on top for desktop, but
 * nothing depends on it: the same `<input type="file">` drives both, and the
 * bottom bar carries a full-width button so the primary action is reachable
 * one-handed.
 */
export function DropZone({
  provider,
  onProviderChange,
  onFileSelected,
  error,
  disabled = false,
}: {
  provider: Provider;
  onProviderChange: (provider: Provider) => void;
  onFileSelected: (file: File) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const accept = React.useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      if (!isPdf(file)) {
        setLocalError(
          `“${file.name}” is not a PDF. Upload the statement PDF your bank or wallet emailed you.`,
        );
        return;
      }
      setLocalError(null);
      onFileSelected(file);
    },
    [onFileSelected],
  );

  const shownError = error ?? localError;

  return (
    <div className="flex flex-col">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a statement</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Upload the statement PDF from your bank or from bKash, Nagad or
          Rocket. Password-protected files are fine — you will be asked for the
          password next.
        </p>
      </div>

      <fieldset className="mt-6" disabled={disabled}>
        <legend className="text-sm font-medium">Where is it from?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {UPLOADABLE_PROVIDERS.map((id) => {
            const meta = PROVIDER_META[id];
            const selected = provider === id;
            const Icon = meta.kind === "wallet" ? Smartphone : Landmark;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => onProviderChange(id)}
                // min-h-11 = 44px: the smallest tap target that is not a coin toss.
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {meta.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label
        htmlFor="statement-file"
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          accept(event.dataTransfer?.files?.[0]);
        }}
        className={cn(
          "mt-6 flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:bg-muted/60",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <Upload className="size-5" aria-hidden />
        </span>
        <span className="text-base font-medium">Tap to choose a PDF</span>
        <span className="max-w-xs text-sm text-muted-foreground">
          <span className="hidden md:inline">Or drag it here. </span>
          Only the transactions are kept — the file itself is never stored.
        </span>
        <input
          ref={inputRef}
          id="statement-file"
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Statement PDF"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files?.[0]);
            // Reset so re-picking the same file still fires a change event.
            event.target.value = "";
          }}
        />
      </label>

      {shownError ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {shownError}
        </p>
      ) : null}

      <div className="mt-6 rounded-lg border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4" aria-hidden />
          What counts as a statement?
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>
            A bank e-statement PDF — the monthly one emailed to you, not a
            screenshot.
          </li>
          <li>
            A bKash, Nagad or Rocket statement PDF exported from the app or
            requested by email.
          </li>
        </ul>
      </div>

      <ThumbZone>
        <Button
          type="button"
          size="lg"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="h-12 w-full text-base"
        >
          <Upload className="size-4" aria-hidden />
          Choose a PDF
        </Button>
      </ThumbZone>
    </div>
  );
}
