"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Signed-in identity and the way out.
 *
 * `router.refresh()` after signOut matters: every app screen is a Server
 * Component reading the session, so without it the browser keeps rendering the
 * previous user's cached dashboard until something else triggers a refetch.
 */
export function SignOutCard({ email }: { email: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Try again.");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <UserRound
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">Signed in</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {email ?? "Your account"}
          </p>
        </div>
      </div>

      <Button
        variant="outline"
        onClick={handleSignOut}
        disabled={busy}
        className="mt-4 h-11 w-full sm:w-auto"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <LogOut className="size-4" aria-hidden />
        )}
        Sign out
      </Button>
    </section>
  );
}
