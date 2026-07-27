import type { Metadata } from "next";
import { OnboardingClient } from "./onboarding-client";

export const metadata: Metadata = {
  title: "Set up your Groq key — Khoroch",
};

export default function OnboardingPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Connect a Groq key
        </h1>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
          Khoroch reads your statements with an AI model running on Groq. The
          key is yours — free to create, and it stays encrypted on our side.
        </p>
      </header>

      <OnboardingClient className="mt-8" />
    </div>
  );
}
