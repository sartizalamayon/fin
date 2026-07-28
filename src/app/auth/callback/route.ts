import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing route for magic links and OAuth redirects. Exchanges the one-time
 * code for a session cookie, then forwards to wherever the user was headed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  // Supabase reports provider failures (denied consent, expired link) here
  // rather than by omitting the code, so surface those first.
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(providerError)}`,
    );
  }

  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const next = safeNextPath(searchParams.get("next"));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
