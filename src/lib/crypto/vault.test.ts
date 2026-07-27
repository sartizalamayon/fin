import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import {
  DecryptionError,
  ENCRYPTION_KEY_ENV,
  EncryptionKeyError,
  decryptSecret,
  encryptSecret,
  generateEncryptionKey,
  getEncryptionKey,
  isVaultConfigured,
  maskSecret,
  secretsMatch,
} from "./vault";

const SAMPLE_KEY = "gsk_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t4f2a";

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env[ENCRYPTION_KEY_ENV];
  process.env[ENCRYPTION_KEY_ENV] = generateEncryptionKey();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env[ENCRYPTION_KEY_ENV];
  else process.env[ENCRYPTION_KEY_ENV] = originalKey;
});

describe("generateEncryptionKey", () => {
  it("produces a 32-byte base64 key", () => {
    const key = generateEncryptionKey();
    expect(Buffer.from(key, "base64")).toHaveLength(32);
  });

  it("produces a different key each call", () => {
    expect(generateEncryptionKey()).not.toBe(generateEncryptionKey());
  });

  it("is accepted by getEncryptionKey", () => {
    process.env[ENCRYPTION_KEY_ENV] = generateEncryptionKey();
    expect(getEncryptionKey()).toHaveLength(32);
  });
});

describe("getEncryptionKey", () => {
  it("throws a clear error when the env var is missing", () => {
    delete process.env[ENCRYPTION_KEY_ENV];
    expect(() => getEncryptionKey()).toThrow(EncryptionKeyError);
    expect(() => getEncryptionKey()).toThrow(/APP_ENCRYPTION_KEY is not set/);
  });

  it("throws when the env var is blank", () => {
    process.env[ENCRYPTION_KEY_ENV] = "   ";
    expect(() => getEncryptionKey()).toThrow(EncryptionKeyError);
  });

  it("throws when the key is the wrong length", () => {
    process.env[ENCRYPTION_KEY_ENV] = randomBytes(16).toString("base64");
    expect(() => getEncryptionKey()).toThrow(/exactly 32 bytes \(got 16\)/);
  });

  it("throws when the key is not base64 at all", () => {
    process.env[ENCRYPTION_KEY_ENV] = "not-a-real-key";
    expect(() => getEncryptionKey()).toThrow(EncryptionKeyError);
  });

  it("tolerates surrounding whitespace from a .env file", () => {
    const key = generateEncryptionKey();
    process.env[ENCRYPTION_KEY_ENV] = `  ${key}\n`;
    expect(getEncryptionKey()).toHaveLength(32);
  });
});

describe("isVaultConfigured", () => {
  it("is true with a valid key", () => {
    expect(isVaultConfigured()).toBe(true);
  });

  it("is false, without throwing, when the key is missing", () => {
    delete process.env[ENCRYPTION_KEY_ENV];
    expect(isVaultConfigured()).toBe(false);
  });
});

describe("encryptSecret / decryptSecret round-trip", () => {
  it("returns the original plaintext", () => {
    expect(decryptSecret(encryptSecret(SAMPLE_KEY))).toBe(SAMPLE_KEY);
  });

  it("round-trips unicode and long values", () => {
    for (const value of ["৳ টাকা", "a".repeat(4096), "🔐 emoji key", "x"]) {
      expect(decryptSecret(encryptSecret(value))).toBe(value);
    }
  });

  it("never leaks the plaintext into the stored value", () => {
    const stored = encryptSecret(SAMPLE_KEY);
    expect(stored).not.toContain(SAMPLE_KEY);
    expect(stored).not.toContain("gsk_");
  });

  it("uses a fresh IV, so the same input yields different ciphertexts", () => {
    const a = encryptSecret(SAMPLE_KEY);
    const b = encryptSecret(SAMPLE_KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("emits a versioned v1.iv.tag.ciphertext envelope", () => {
    const parts = encryptSecret(SAMPLE_KEY).split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12); // IV
    expect(Buffer.from(parts[2], "base64")).toHaveLength(16); // GCM auth tag
  });

  it("rejects empty input", () => {
    expect(() => encryptSecret("")).toThrow(TypeError);
  });
});

describe("tamper detection", () => {
  /** Flip the final byte of a base64 segment so it decodes differently. */
  function corruptSegment(stored: string, index: number): string {
    const parts = stored.split(".");
    const buf = Buffer.from(parts[index], "base64");
    buf[buf.length - 1] ^= 0xff;
    parts[index] = buf.toString("base64");
    return parts.join(".");
  }

  it("throws when the ciphertext is modified", () => {
    const tampered = corruptSegment(encryptSecret(SAMPLE_KEY), 3);
    expect(() => decryptSecret(tampered)).toThrow(DecryptionError);
  });

  it("throws when the auth tag is modified", () => {
    const tampered = corruptSegment(encryptSecret(SAMPLE_KEY), 2);
    expect(() => decryptSecret(tampered)).toThrow(DecryptionError);
  });

  it("throws when the IV is modified", () => {
    const tampered = corruptSegment(encryptSecret(SAMPLE_KEY), 1);
    expect(() => decryptSecret(tampered)).toThrow(DecryptionError);
  });

  it("throws when the ciphertext is truncated", () => {
    const stored = encryptSecret(SAMPLE_KEY);
    const parts = stored.split(".");
    const buf = Buffer.from(parts[3], "base64");
    parts[3] = buf.subarray(0, buf.length - 2).toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow(DecryptionError);
  });

  it("throws when decrypted under a different master key", () => {
    const stored = encryptSecret(SAMPLE_KEY);
    process.env[ENCRYPTION_KEY_ENV] = generateEncryptionKey();
    expect(() => decryptSecret(stored)).toThrow(DecryptionError);
  });

  it("does not reveal whether the key or the data was wrong", () => {
    const stored = encryptSecret(SAMPLE_KEY);
    process.env[ENCRYPTION_KEY_ENV] = generateEncryptionKey();
    expect(() => decryptSecret(stored)).toThrow(
      /wrong encryption key or the value was tampered with/,
    );
  });

  it("rejects malformed envelopes", () => {
    for (const bad of ["", "garbage", "v1.aaa", "v1.a.b.c.d"]) {
      expect(() => decryptSecret(bad)).toThrow(DecryptionError);
    }
  });

  it("rejects an unknown envelope version", () => {
    const stored = encryptSecret(SAMPLE_KEY);
    const forged = `v9${stored.slice(2)}`;
    expect(() => decryptSecret(forged)).toThrow(/Unsupported secret envelope/);
  });

  it("rejects an IV of the wrong size", () => {
    const parts = encryptSecret(SAMPLE_KEY).split(".");
    parts[1] = randomBytes(8).toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow(/iv must be 12 bytes/);
  });

  it("rejects an auth tag of the wrong size", () => {
    const parts = encryptSecret(SAMPLE_KEY).split(".");
    parts[2] = randomBytes(8).toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow(
      /auth tag must be 16 bytes/,
    );
  });
});

describe("maskSecret", () => {
  it("keeps the gsk_ prefix and the last 4 characters", () => {
    expect(maskSecret(SAMPLE_KEY)).toBe("gsk_••••••••4f2a");
  });

  it("hides everything between the prefix and the tail", () => {
    const masked = maskSecret(SAMPLE_KEY);
    expect(masked).not.toContain("A1b2C3d4");
    // 4 prefix + 8 bullets + 4 tail
    expect([...masked]).toHaveLength(16);
  });

  it("masks values with no provider prefix", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("••••••••mnop");
  });

  it("reveals nothing for values too short to mask safely", () => {
    expect(maskSecret("gsk_abcd")).toBe("gsk_••••••••");
    expect(maskSecret("short")).toBe("••••••••");
  });

  it("returns an empty string for empty or whitespace input", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("   ")).toBe("");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskSecret(`  ${SAMPLE_KEY}  `)).toBe("gsk_••••••••4f2a");
  });

  it("needs no encryption key to be configured", () => {
    delete process.env[ENCRYPTION_KEY_ENV];
    expect(maskSecret(SAMPLE_KEY)).toBe("gsk_••••••••4f2a");
  });

  it("distinguishes two different keys by their tails", () => {
    expect(maskSecret("gsk_aaaaaaaaaaaaaaaa1111")).not.toBe(
      maskSecret("gsk_aaaaaaaaaaaaaaaa2222"),
    );
  });
});

describe("secretsMatch", () => {
  it("is true for identical values", () => {
    expect(secretsMatch(SAMPLE_KEY, SAMPLE_KEY)).toBe(true);
  });

  it("is false for different values of equal length", () => {
    expect(secretsMatch("gsk_aaaa", "gsk_aaab")).toBe(false);
  });

  it("is false for different lengths without throwing", () => {
    expect(secretsMatch("gsk_a", SAMPLE_KEY)).toBe(false);
  });
});
