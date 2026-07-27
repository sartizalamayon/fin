import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — Khoroch" };

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Khoroch</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Sign in with your email. We send a link — no password to remember.
        </p>
      </header>

      <Suspense fallback={null}>
        <LoginForm className="mt-8" />
      </Suspense>
    </div>
  );
}
