/**
 * Which routes need a session, and where it is safe to send someone afterwards.
 *
 * Extracted from the proxy so both the proxy and the OAuth callback share one
 * definition — two lists that drift apart is how a screen ends up reachable
 * signed out.
 */

/**
 * Routes that require a session.
 *
 * `/onboarding` is here because it collects the user's Groq API key. A key
 * pasted without a session has no row to attach to, so the request fails after
 * the user has already handed over a credential — which teaches them their key
 * was rejected when the real problem was that nobody was signed in.
 */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/upload",
  "/transactions",
  "/settings",
  "/onboarding",
] as const;

/**
 * Prefix match on whole path segments.
 *
 * `/settings-export` must NOT match `/settings`: a plain `startsWith` would
 * gate unrelated sibling routes, and worse, would make a future public route
 * silently require auth because it happened to share a prefix.
 */
export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Where to send a signed-out visitor, preserving where they meant to go. */
export function loginRedirectPath(pathname: string, search = ""): string {
  const destination = `${pathname}${search}`;
  return `/login?next=${encodeURIComponent(destination)}`;
}

/**
 * Sanitise a `next` parameter before redirecting to it.
 *
 * Sign-in links get forwarded, pasted and shortened, so `next` is attacker
 * controlled. Anything that could leave this origin is rejected:
 *   - absolute URLs (`https://evil.test`)
 *   - protocol-relative URLs (`//evil.test`), which browsers treat as absolute
 *   - backslash variants (`/\evil.test`), which some parsers normalise to `//`
 *   - anything not starting with `/`
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!next) return fallback;

  const value = next.trim();
  if (value === "") return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  // `/\` and `/%5C` both normalise to a protocol-relative URL in some browsers.
  if (/^\/[\\]/.test(value)) return fallback;
  if (/^\/%2f/i.test(value) || /^\/%5c/i.test(value)) return fallback;
  if (value.includes("\\")) return fallback;

  return value;
}
