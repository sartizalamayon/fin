"use client";

import * as React from "react";
import { CircleAlert, Eye, EyeOff, Lock, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Provider } from "@/lib/core/types";
import { passwordHintFor, providerLabel } from "./provider-meta";
import { ThumbZone } from "./thumb-zone";

/**
 * The PDF is encrypted and we need the password.
 *
 * A wrong password re-renders this same screen with an error and the file still
 * held — being thrown back to the file picker after one typo is how people
 * abandon an import. The hint is provider-specific because the password was
 * chosen by the issuer, not the user: they are not remembering it, they are
 * being told what it is.
 */
export function PasswordPrompt({
  filename,
  provider,
  value,
  onValueChange,
  onSubmit,
  onCancel,
  error,
  attempt = 0,
  isSubmitting = false,
}: {
  filename: string;
  provider: Provider | null;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Set after a rejected attempt. */
  error?: string | null;
  attempt?: number;
  isSubmitting?: boolean;
}) {
  const [reveal, setReveal] = React.useState(false);
  const canSubmit = value.trim().length > 0 && !isSubmitting;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="flex flex-col"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Lock className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        This statement is locked
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{filename}</span> is
        password-protected by {providerLabel(provider)}. Enter the password to
        unlock it. It is used once, in memory, and never saved.
      </p>

      {error ? (
        <div
          role="alert"
          data-testid="password-error"
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {error}
            {attempt > 1 ? (
              <span className="mt-0.5 block text-xs opacity-80">
                Attempt {attempt}. The file is still here — try another
                password.
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="mt-6">
        <Label htmlFor="statement-password">Statement password</Label>
        <div className="mt-2 flex items-center gap-2">
          <Input
            id="statement-password"
            name="password"
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            // inputMode=numeric because every real-world hint here is digits.
            inputMode="numeric"
            aria-invalid={error ? true : undefined}
            aria-describedby="statement-password-hint"
            placeholder="Enter the password"
            className="h-12 flex-1 text-base"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setReveal((current) => !current)}
            aria-pressed={reveal}
            aria-label={reveal ? "Hide password" : "Show password"}
            className="size-12 shrink-0"
          >
            {reveal ? (
              <EyeOff className="size-5" aria-hidden />
            ) : (
              <Eye className="size-5" aria-hidden />
            )}
          </Button>
        </div>
        <p
          id="statement-password-hint"
          data-testid="password-hint"
          className="mt-2 text-sm text-muted-foreground"
        >
          {passwordHintFor(provider)}
        </p>
      </div>

      <ThumbZone>
        <Button
          type="submit"
          size="lg"
          disabled={!canSubmit}
          className="h-12 w-full text-base"
        >
          {isSubmitting ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : null}
          {isSubmitting ? "Unlocking…" : "Unlock statement"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
          className="h-11 w-full"
        >
          Choose a different file
        </Button>
      </ThumbZone>
    </form>
  );
}
