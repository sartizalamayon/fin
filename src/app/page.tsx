import Link from "next/link";
import { ShieldCheck, FileLock2, ChartNoAxesCombined } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

const FEATURES = [
  {
    icon: FileLock2,
    title: "Password-protected statements, handled",
    body: "bKash, Nagad and bank statements arrive encrypted. Unlock yours with its password — the file is read in memory and never stored.",
  },
  {
    icon: ShieldCheck,
    title: "Every import is proven, not guessed",
    body: "Extracted rows are added up and checked against the statement's own closing balance. If the arithmetic doesn't match exactly, nothing is imported.",
  },
  {
    icon: ChartNoAxesCombined,
    title: "One ledger across every account",
    body: "Bank and mobile money in a single view. Moving your own money between them is netted out instead of counted twice.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4 md:px-8">
        <span className="text-lg font-semibold tracking-tight">fin.</span>
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Open app
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 md:px-8">
        <section className="py-10 md:py-16">
          <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            Every account you use, in one honest ledger.
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Upload a bank or bKash statement. It gets unlocked, every
            transaction pulled out, and the total verified against the
            statement itself before a single figure reaches your dashboard.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/onboarding"
              className={buttonVariants({
                size: "lg",
                className: "h-12 w-full sm:w-auto",
              })}
            >
              Get started
            </Link>
            <Link
              href="/dashboard"
              className={buttonVariants({
                size: "lg",
                variant: "outline",
                className: "h-12 w-full sm:w-auto",
              })}
            >
              See the dashboard
            </Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 md:gap-6">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border p-5">
              <Icon className="size-5 text-primary" aria-hidden />
              <h2 className="mt-3 font-medium">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
