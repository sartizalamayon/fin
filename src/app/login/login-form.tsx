"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import {
  describeAuthError,
  enabledOAuthProviders,
  type OAuthProvider,
} from "@/lib/auth/providers";
import { safeNextPath } from "@/lib/auth/routes";
import { GoogleMark, OutlookMark } from "@/components/auth/provider-marks";
import { cn } from "@/lib/utils";

/**
 * Sign-in.
 *
 * OAuth first, email link second: most people would rather tap a button they
 * recognise than leave the app, open a mail client and come back. The email
 * link stays because it needs no third-party account at all.
 *
 * There is deliberately no password field. This app holds financial records,
 * and a password we store is a password we can leak.
 */
export function LoginForm({ className }: { className?: string }) {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const linkError = params.get("error");

  const providers = React.useMemo(() => enabledOAuthProviders(), []);

  const [email, setEmail] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [pendingProvider, setPendingProvider] =
    React.useState<OAuthProvider | null>(null);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(
    linkError ? describeLinkError(linkError) : null,
  );

  const busy = sending || pendingProvider !== null;

  function callbackUrl() {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  }

  async function handleOAuth(provider: OAuthProvider) {
    setError(null);
    setPendingProvider(provider);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: provider.id,
        options: { redirectTo: callbackUrl(), scopes: provider.scopes },
      });

      if (authError) {
        setError(describeAuthError(authError.message, provider.label));
        setPendingProvider(null);
      }
      // On success the browser navigates away; leave the button spinning.
    } catch {
      setError("Could not reach the sign-in service. Try again.");
      setPendingProvider(null);
    }
  }

  async function handleEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSending(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: callbackUrl() },
      });

      if (authError) {
        setError(describeAuthError(authError.message));
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
          We sent a sign-in link to{" "}
          <span className="text-foreground">{email}</span>. Open it on this
          device.
        </p>
        <Button
          variant="ghost"
          className="mt-4 h-11"
          onClick={() => {
            setSent(false);
            setEmail("");
          }}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {providers.length > 0 ? (
        <>
          <div className="flex flex-col gap-2">
            {providers.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => handleOAuth(provider)}
                className="h-12 w-full"
              >
                {pendingProvider?.id === provider.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : provider.id === "google" ? (
                  <GoogleMark />
                ) : (
                  <OutlookMark />
                )}
                Continue with {provider.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
        </>
      ) : null}

      <form onSubmit={handleEmail} className="flex flex-col gap-3">
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
          disabled={busy || email.length === 0}
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
    </div>
  );
}

/** Errors the callback route hands back in the query string. */
function describeLinkError(code: string): string {
  switch (code) {
    case "missing_code":
      return "That sign-in link was incomplete. Request a new one.";
    case "invalid_link":
      return "That sign-in link has expired or was already used. Request a new one.";
    default:
      return describeAuthError(decodeURIComponent(code));
  }
}
