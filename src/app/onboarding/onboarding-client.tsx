"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  GroqKeyStepper,
  GROQ_STEPS,
} from "@/components/onboarding/groq-key-stepper";
import { WhyGroqKey } from "@/components/onboarding/why-groq-key";
import {
  isLikelyGroqKey,
  groqKeyProblem,
} from "@/components/onboarding/groq-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Drives the key-setup stepper and submits to /api/settings/groq.
 *
 * The key is validated in the browser before it is sent, purely so a mistyped
 * paste costs a moment rather than a round trip. The server validates again —
 * this check is convenience, not security.
 */
export function OnboardingClient({ className }: { className?: string }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [apiKey, setApiKey] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const problem = groqKeyProblem(apiKey);
  const malformed = problem !== null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!isLikelyGroqKey(apiKey)) {
      setError(
        problem ?? 'Groq keys start with "gsk_". Copy it again from the API Keys page.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/settings/groq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      if (response.status === 401) {
        setError("Your session expired. Sign in again, then retry.");
        return;
      }

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          payload?.message ?? "That key could not be saved. Try again.",
        );
        return;
      }

      // Clear it from component state the moment it is stored.
      setApiKey("");
      toast.success("Groq key saved", {
        description: "You're ready to upload a statement.",
      });
      router.push("/upload");
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-8", className)}>
      <GroqKeyStepper
        currentStep={step}
        onStepSelect={setStep}
        onNext={() => setStep((s) => Math.min(s + 1, GROQ_STEPS.length - 1))}
      >
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="groq-key">Your Groq API key</Label>
            <div className="relative">
              <Input
                id="groq-key"
                name="groq-key"
                type={reveal ? "text" : "password"}
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="gsk_..."
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                aria-invalid={malformed || error !== null}
                aria-describedby="groq-key-help"
                className="h-12 pr-12 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                // 44px target: this sits next to a text field on a phone.
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground"
                aria-label={reveal ? "Hide key" : "Show key"}
              >
                {reveal ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
            <p id="groq-key-help" className="text-xs text-muted-foreground">
              Stored encrypted. It is never shown again after you save it.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={submitting || apiKey.length === 0}
            className="h-12 w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving
              </>
            ) : (
              "Save key and continue"
            )}
          </Button>
        </form>
      </GroqKeyStepper>

      <WhyGroqKey />
    </div>
  );
}
