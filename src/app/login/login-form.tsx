"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Magic-link sign-in.
 *
 * No password field on purpose: this app holds financial records, and a
 * password we store is a password we can leak. Supabase owns the link flow.
 */
export function LoginForm({ className }: { className?: string }) {
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [email, setEmail] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSending(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }
      setSent(true);
    } catch {
      setError("Could not reach the sign-in service. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className={cn("rounded-xl border p-6 text-center", className)}>
        <MailCheck className="mx-auto size-6 text-primary" aria-hidden />
        <h2 className="mt-3 font-medium">Check your email</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          We sent a sign-in link to <span className="text-foreground">{email}</span>.
          Open it on this device.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error !== null}
          className="h-12"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={sending || email.length === 0}
        className="h-12 w-full"
      >
        {sending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Sending
          </>
        ) : (
          "Send sign-in link"
        )}
      </Button>
    </form>
  );
}
