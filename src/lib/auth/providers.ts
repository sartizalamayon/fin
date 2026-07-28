/**
 * Third-party sign-in providers.
 *
 * Supabase calls Microsoft/Outlook `azure`. The label says "Outlook" because
 * that is the word a person recognises on a sign-in button; the provider id is
 * what the API wants.
 */

export type OAuthProviderId = "google" | "azure";

export interface OAuthProvider {
  id: OAuthProviderId;
  label: string;
  /** Extra scopes Supabase should request. Azure needs `email` explicitly. */
  scopes?: string;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProvider> = {
  google: { id: "google", label: "Google" },
  azure: { id: "azure", label: "Outlook", scopes: "email openid profile" },
};

/**
 * Which providers to offer, from NEXT_PUBLIC_AUTH_PROVIDERS (comma separated).
 *
 * Defaults to both. A provider that is listed here but has no client
 * credentials in Supabase produces a clear "not enabled" error rather than a
 * silent failure — see the login form.
 */
export function enabledOAuthProviders(
  raw: string | undefined = process.env.NEXT_PUBLIC_AUTH_PROVIDERS,
): OAuthProvider[] {
  const configured = raw?.trim();
  if (configured === "") return [];

  const ids = (configured ?? "google,azure")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: OAuthProvider[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const provider = OAUTH_PROVIDERS[id as OAuthProviderId];
    if (provider) out.push(provider);
  }
  return out;
}

/**
 * Turn a Supabase auth error into something the person reading it can act on.
 *
 * The default messages are written for developers — "Unsupported provider"
 * tells a user nothing about what to do next.
 */
export function describeAuthError(
  message: string | null | undefined,
  providerLabel?: string,
): string {
  const text = (message ?? "").toLowerCase();

  if (text.includes("not enabled") || text.includes("unsupported provider")) {
    return providerLabel
      ? `${providerLabel} sign-in is not switched on for this app yet. Use the email link below instead.`
      : "That sign-in method is not switched on for this app yet.";
  }
  if (text.includes("rate") || text.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (text.includes("invalid") && text.includes("email")) {
    return "That email address does not look right.";
  }
  return message?.trim() || "Something went wrong signing in. Try again.";
}
