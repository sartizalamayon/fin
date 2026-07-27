import type { Metadata } from "next";
import { GroqKeyCard } from "./groq-key-card";

export const metadata: Metadata = {
  title: "Settings — Khoroch",
};

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <GroqKeyCard />

      <section className="rounded-xl border p-4">
        <h2 className="text-sm font-medium">What Khoroch stores</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="text-foreground">Transaction rows</span> — the
            figures extracted from your statements, plus the source line each
            came from.
          </li>
          <li>
            <span className="text-foreground">Never the statement file.</span>{" "}
            Uploads are read in memory and discarded when the import finishes.
          </li>
          <li>
            <span className="text-foreground">Never your PDF password.</span>{" "}
            It unlocks one upload and is dropped.
          </li>
          <li>
            <span className="text-foreground">Your Groq key, encrypted.</span>{" "}
            AES-256-GCM at rest, and never sent back to your browser.
          </li>
        </ul>
      </section>
    </div>
  );
}
