/**
 * Supabase environment resolution, shared by the browser client, the server
 * client and the middleware so they can never disagree about which project
 * they are talking to.
 *
 * Only NEXT_PUBLIC_* values live here. The service-role key must never be
 * imported into anything that can reach a bundle.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/**
 * Read the public Supabase config, or null when it is absent.
 *
 * Absent is a legitimate state: local development runs against plain Postgres
 * with no Supabase project at all. Callers decide whether that is fatal.
 */
export function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // Newer projects issue a "publishable" key; older ones call it "anon".
  const anonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )?.trim();

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Same as readSupabaseEnv(), but throws with a fixable message. */
export function requireSupabaseEnv(): SupabaseEnv {
  const env = readSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment.",
    );
  }
  return env;
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv() !== null;
}
