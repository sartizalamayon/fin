/**
 * Client-side shape checks for a Groq API key.
 *
 * This is not authentication — only Groq can say whether a key works. The point
 * is to catch the common paste mistakes (half a key, the key name instead of
 * the key, a stray quote) before we spend a round trip and show the user a
 * scary 401.
 */

export const GROQ_KEY_PREFIX = "gsk_";

/** Groq issues `gsk_` followed by a long opaque string. */
const GROQ_KEY_PATTERN = /^gsk_[A-Za-z0-9_-]{16,}$/;

export function isLikelyGroqKey(value: string): boolean {
  return GROQ_KEY_PATTERN.test(value.trim());
}

/** Why a value was rejected, phrased for a person rather than a validator. */
export function groqKeyProblem(value: string): string | null {
  const key = value.trim();
  if (key.length === 0) return null;
  if (!key.startsWith(GROQ_KEY_PREFIX)) {
    return `Groq keys start with ${GROQ_KEY_PREFIX} — this looks like something else. Copy the key itself, not its name.`;
  }
  if (!GROQ_KEY_PATTERN.test(key)) {
    return "That key looks cut short. Copy the whole thing from the Groq console.";
  }
  return null;
}

/** `gsk_••••••••••••3f9a` — enough to recognise, useless to steal. */
export function maskGroqKey(value: string): string {
  const key = value.trim();
  if (key.length <= GROQ_KEY_PREFIX.length + 4) return `${GROQ_KEY_PREFIX}••••`;
  return `${GROQ_KEY_PREFIX}${"•".repeat(12)}${key.slice(-4)}`;
}
