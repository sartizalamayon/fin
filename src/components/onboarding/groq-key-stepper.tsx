"use client";

import { Check, ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface GroqStep {
  title: string;
  detail: string;
  link?: { href: string; label: string };
  /** Label for the button that advances past this step. */
  advanceLabel?: string;
}

export const GROQ_STEPS: GroqStep[] = [
  {
    title: "Sign up at groq.com",
    detail:
      "Groq's free tier is more than enough to read your statements. Signing up takes about a minute — email or Google.",
    link: { href: "https://groq.com", label: "Open groq.com" },
    advanceLabel: "I've signed up",
  },
  {
    title: "Log in",
    detail:
      "Log in to the Groq console with the account you just created. You'll land on the console dashboard.",
    link: { href: "https://console.groq.com/login", label: "Open the Groq console" },
    advanceLabel: "I'm logged in",
  },
  {
    title: "Open the API Keys section",
    detail:
      "In the console's left-hand menu, tap “API Keys”. On a phone the menu is behind the ☰ button in the top corner.",
    link: { href: "https://console.groq.com/keys", label: "Go straight to API Keys" },
    advanceLabel: "I found it",
  },
  {
    title: "Create a new API key",
    detail:
      "Tap “Create API Key”, name it anything you like — “fin” works — and copy the key. Groq shows it once and never again, so copy it before you close the box.",
    advanceLabel: "I've copied my key",
  },
  {
    title: "Paste it here",
    detail:
      "Paste the key below. It is encrypted before it is stored and never shown again.",
  },
];

/**
 * Vertical stepper.
 *
 * Vertical on every width, not just phones — the steps are sentences, and a
 * horizontal stepper would truncate them into meaninglessness on 375px. One
 * step is open at a time so the screen stays short; finished steps collapse to
 * a tappable line you can go back to.
 */
export function GroqKeyStepper({
  currentStep,
  onStepSelect,
  onNext,
  children,
  className,
}: {
  /** 0-based index of the open step. */
  currentStep: number;
  onStepSelect: (index: number) => void;
  onNext: () => void;
  /** Body of the final step — the key form. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {GROQ_STEPS.map((step, index) => {
        const isDone = index < currentStep;
        const isCurrent = index === currentStep;
        const isLast = index === GROQ_STEPS.length - 1;

        return (
          <li
            key={step.title}
            data-testid={`step-${index + 1}`}
            data-state={isDone ? "done" : isCurrent ? "current" : "pending"}
            className="relative flex gap-3 pb-2"
          >
            {!isLast ? (
              <span
                aria-hidden
                className="absolute top-9 bottom-0 left-[15px] w-px bg-border"
              />
            ) : null}

            <span
              className={cn(
                "z-10 mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium",
                isDone && "border-emerald-600 bg-emerald-600 text-white",
                isCurrent && "border-primary bg-primary text-primary-foreground",
                !isDone && !isCurrent && "border-border bg-background text-muted-foreground",
              )}
            >
              {isDone ? <Check className="size-4" aria-hidden /> : index + 1}
            </span>

            <div className="min-w-0 flex-1 pb-4">
              <button
                type="button"
                onClick={() => onStepSelect(index)}
                aria-expanded={isCurrent}
                // Full-width min-44px target: on a phone this line is the control.
                className="flex min-h-11 w-full items-center text-left"
              >
                <span
                  className={cn(
                    "text-base font-medium",
                    !isCurrent && !isDone && "text-muted-foreground",
                  )}
                >
                  {step.title}
                </span>
              </button>

              {isCurrent ? (
                <div className="mt-1">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {step.detail}
                  </p>

                  {step.link ? (
                    <a
                      href={step.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        buttonVariants({ variant: "outline", size: "lg" }),
                        "mt-3 h-11 w-full text-base",
                      )}
                    >
                      {step.link.label}
                      <ExternalLink className="size-4" aria-hidden />
                    </a>
                  ) : null}

                  {step.advanceLabel ? (
                    <Button
                      type="button"
                      onClick={onNext}
                      className="mt-2 h-11 w-full text-base"
                    >
                      {step.advanceLabel}
                    </Button>
                  ) : null}

                  {isLast ? <div className="mt-3">{children}</div> : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
