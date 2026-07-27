"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KeyRound, Loader2, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface KeyState {
  configured: boolean;
  masked: string | null;
}

/**
 * Groq key management.
 *
 * The plaintext key is never fetched — the API only ever answers with a mask,
 * so there is nothing here that could leak it back into the page.
 */
export function GroqKeyCard() {
  const [state, setState] = React.useState<KeyState | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/groq")
      .then((r) => (r.ok ? r.json() : { configured: false, masked: null }))
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {
        if (!cancelled) setState({ configured: false, masked: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRemove() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/groq", { method: "DELETE" });
      if (!response.ok) throw new Error("failed");
      setState({ configured: false, masked: null });
      toast.success("Groq key removed");
    } catch {
      toast.error("Could not remove the key. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">Groq API key</h2>

          {state === null ? (
            <Skeleton className="mt-2 h-5 w-40" />
          ) : state.configured ? (
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {state.masked}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No key yet. You need one before you can import a statement.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/onboarding"
          className={buttonVariants({
            variant: state?.configured ? "outline" : "default",
            className: "h-11 w-full sm:w-auto",
          })}
        >
          {state?.configured ? "Replace key" : "Add a key"}
        </Link>

        {state?.configured ? (
          <Button
            variant="destructive"
            onClick={handleRemove}
            disabled={busy}
            className="h-11 w-full sm:w-auto"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
            Remove
          </Button>
        ) : null}
      </div>
    </section>
  );
}
