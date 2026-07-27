import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { readSupabaseEnv, requireSupabaseEnv } from "./env";

/**
 * Server Supabase client bound to the request's cookies.
 *
 * Next.js 16 makes `cookies()` async, so this is async too. Writes are wrapped
 * because Server Components are not allowed to set cookies — in that context
 * the middleware has already refreshed the session, so swallowing the write is
 * correct rather than merely convenient.
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. Middleware owns session refresh.
        }
      },
    },
  });
}

/**
 * The signed-in user, or null.
 *
 * Always uses `getUser()`, never `getSession()`: only `getUser()` revalidates
 * the token against Supabase. A session read straight from the cookie is
 * attacker-supplied data, and this value gates access to financial records.
 */
export async function getCurrentUser() {
  if (!readSupabaseEnv()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ?? null;
}

/** Throws when there is no session. For route handlers that require one. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("You must be signed in to do that.");
    this.name = "UnauthorizedError";
  }
}
