/**
 * Secret vault — AES-256-GCM envelope encryption for user-supplied API keys.
 *
 * Users bring their own Groq key. It is encrypted at rest with a server-side
 * master key (APP_ENCRYPTION_KEY) and NEVER returned to a client; the UI only
 * ever sees `maskSecret()` output.
 *
 * GCM, not CBC: we need authentication, not just confidentiality. A tampered
 * ciphertext must fail loudly rather than decrypt to garbage that we then
 * ship to Groq as a bearer token.
 *
 * Server-only. Importing this from a client component is a bug — the master
 * key lives in a non-NEXT_PUBLIC env var and would be undefined in a browser.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const AUTH_TAG_BYTES = 16;

/** Envelope version prefix, so the format can change without breaking rows. */
const VERSION = "v1";

export const ENCRYPTION_KEY_ENV = "APP_ENCRYPTION_KEY";

/** Thrown when APP_ENCRYPTION_KEY is absent or not a 32-byte base64 value. */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

/** Thrown when a stored value is malformed, truncated, or has been tampered with. */
export class DecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DecryptionError";
  }
}

/**
 * Generate a fresh master key, base64-encoded, for APP_ENCRYPTION_KEY.
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Rotating this key makes every stored secret undecryptable — users have to
 * re-enter their API keys.
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/**
 * Resolve the master key from the environment.
 *
 * Read on every call rather than cached at module load: Next.js evaluates
 * modules before some runtimes populate env, and tests need to swap the key
 * between cases.
 */
export function getEncryptionKey(): Buffer {
  const raw = process.env[ENCRYPTION_KEY_ENV];

  if (!raw || raw.trim() === "") {
    throw new EncryptionKeyError(
      `${ENCRYPTION_KEY_ENV} is not set. Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  // Buffer.from(..., "base64") silently drops invalid characters rather than
  // throwing, so a corrupt value shows up as a wrong byte length below.
  const key = Buffer.from(raw.trim(), "base64");

  if (key.length !== KEY_BYTES) {
    throw new EncryptionKeyError(
      `${ENCRYPTION_KEY_ENV} must decode to exactly ${KEY_BYTES} bytes ` +
        `(got ${key.length}). Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  return key;
}

/** True when a usable master key is configured. Never throws. */
export function isVaultConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a secret for storage.
 *
 * Returns `v1.<iv>.<authTag>.<ciphertext>`, all base64. A fresh random IV per
 * call means encrypting the same key twice yields different ciphertexts —
 * that is deliberate, so stored values cannot be compared for equality.
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext === "") {
    throw new TypeError("encryptSecret requires a non-empty string");
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Decrypt a stored secret.
 *
 * Throws DecryptionError if the envelope is malformed OR if the auth tag does
 * not verify — i.e. any tampering with the ciphertext, IV, or tag.
 */
export function decryptSecret(stored: string): string {
  if (typeof stored !== "string" || stored === "") {
    throw new DecryptionError("Nothing to decrypt: value is empty");
  }

  const parts = stored.split(".");
  if (parts.length !== 4) {
    throw new DecryptionError(
      `Malformed secret envelope: expected 4 dot-separated parts, got ${parts.length}`,
    );
  }

  const [version, ivB64, tagB64, dataB64] = parts;
  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported secret envelope version: ${version}`);
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");

  if (iv.length !== IV_BYTES) {
    throw new DecryptionError(
      `Malformed secret envelope: iv must be ${IV_BYTES} bytes, got ${iv.length}`,
    );
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new DecryptionError(
      `Malformed secret envelope: auth tag must be ${AUTH_TAG_BYTES} bytes, got ${authTag.length}`,
    );
  }

  const key = getEncryptionKey();

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    // final() throws when the GCM tag does not verify. Deliberately vague:
    // the caller must not be able to distinguish "wrong key" from "tampered".
    throw new DecryptionError(
      "Failed to decrypt secret: wrong encryption key or the value was tampered with",
      { cause },
    );
  }
}

/**
 * Mask a secret for display, e.g. "gsk_abc...4f2a" -> "gsk_••••••••4f2a".
 *
 * Keeps the provider prefix (users have several keys and the prefix is not
 * sensitive) and the last 4 characters (enough to tell keys apart). Short
 * values reveal nothing at all.
 */
export function maskSecret(plaintext: string): string {
  if (typeof plaintext !== "string") return "";

  const value = plaintext.trim();
  if (value === "") return "";

  const bullets = "••••••••";

  // A short leading "xxx_" token is a provider tag, not secret material.
  const prefixMatch = /^([A-Za-z][A-Za-z0-9]{1,7}_)/.exec(value);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  const body = value.slice(prefix.length);

  // Too little entropy left to show a tail without leaking most of the value.
  if (body.length <= 8) return `${prefix}${bullets}`;

  return `${prefix}${bullets}${body.slice(-4)}`;
}

/**
 * Constant-time comparison, for checking a submitted key against a decrypted
 * one without leaking length/prefix information through timing.
 */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
