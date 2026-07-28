import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabaseEnv } from "@/lib/supabase/env";
import { isProtectedRoute, loginRedirectPath } from "@/lib/auth/routes";

export default async function proxy(request: NextRequest) {
  const env = readSupabaseEnv();

  /*
   * Supabase falls back to the project's Site URL when a redirect target is not
   * on its allow list, and that fallback drops the path — so a magic link can
   * land on `/?code=...` instead of `/auth/callback?code=...` and the code is
   * never exchanged. The allow list is configured correctly now; this forwards
   * any stray code anyway, because a misconfiguration here looks to the user
   * like a broken login with no error at all.
   */
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const callback = request.nextUrl.clone();
    callback.pathname = "/auth/callback";
    return NextResponse.redirect(callback);
  }

  // No Supabase configured (local development against plain Postgres): there
  // are no sessions to refresh and nothing to gate on.
  if (!env) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the token with Supabase and refreshes it when close
  // to expiry, which is the whole reason this middleware exists. Do not swap it
  // for getSession() — that trusts the cookie without checking it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedRoute(request.nextUrl.pathname)) {
    const target = loginRedirectPath(
      request.nextUrl.pathname,
      request.nextUrl.search,
    );
    return NextResponse.redirect(new URL(target, request.nextUrl.origin));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets — matching those
     * would refresh the session on every image request.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
