import { KeyRound, ShieldCheck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const POINTS = [
  {
    icon: KeyRound,
    title: "What the key does",
    body: "It lets this app send your statement's text to Groq, which reads it and pulls out every transaction — date, amount, who it went to. Without a key there is nothing to read your PDF.",
  },
  {
    icon: Wallet,
    title: "Why yours and not ours",
    body: "You use your own free Groq account, so your statements go through your account and nobody bills you for someone else's usage. A month of statements costs nothing on the free tier.",
  },
  {
    icon: ShieldCheck,
    title: "How it is stored",
    body: "The key is encrypted before it is saved and is never shown again — not to you, not in logs. You can replace or delete it at any time from Settings.",
  },
] as const;

/** The honest answer to "why is this app asking me for an API key?". */
export function WhyGroqKey({ className }: { className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4", className)}>
      <h2 className="text-sm font-medium">Why you need a key</h2>
      <ul className="mt-3 space-y-4">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
