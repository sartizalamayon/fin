import { describe, expect, it } from "vitest";
import { DocumentSchema } from "../core/types";
import { findDuplicateUpload, hashFile } from "./hash";
import { makeDoc, resetFixtureIds } from "./test-helpers";

const encoder = new TextEncoder();

/** Published SHA-256 test vectors — proves we hash the bytes, not a wrapper. */
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABC_SHA256 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("hashFile", () => {
  it("matches the known digest of the empty input", () => {
    expect(hashFile(new Uint8Array())).toBe(EMPTY_SHA256);
  });

  it("matches the known digest of 'abc'", () => {
    expect(hashFile(encoder.encode("abc"))).toBe(ABC_SHA256);
  });

  it("returns 64 lowercase hex characters, as Document.fileHash requires", () => {
    const hash = hashFile(encoder.encode("bkash statement february"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      DocumentSchema.parse({ ...makeDoc(), fileHash: hash }),
    ).not.toThrow();
  });

  it("is deterministic: the same bytes always hash the same", () => {
    const bytes = encoder.encode("Statement of Account\nTrxID 8H2K9LMN01\n");
    expect(hashFile(bytes)).toBe(hashFile(bytes));
    expect(hashFile(bytes)).toBe(hashFile(encoder.encode(
      "Statement of Account\nTrxID 8H2K9LMN01\n",
    )));
  });

  it("changes completely when a single byte changes", () => {
    const a = hashFile(encoder.encode("amount 5000"));
    const b = hashFile(encoder.encode("amount 5001"));
    expect(a).not.toBe(b);
  });

  it("distinguishes same-length payloads with reordered bytes", () => {
    expect(hashFile(new Uint8Array([1, 2, 3]))).not.toBe(
      hashFile(new Uint8Array([3, 2, 1])),
    );
  });

  it("handles a large binary payload", () => {
    const big = new Uint8Array(1024 * 512);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251;
    expect(hashFile(big)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFile(big)).toBe(hashFile(big));
  });

  it("does not confuse a prefix with the whole file", () => {
    const full = encoder.encode("page1page2");
    const prefix = encoder.encode("page1");
    expect(hashFile(full)).not.toBe(hashFile(prefix));
  });
});

describe("findDuplicateUpload", () => {
  it("catches a byte-identical re-upload before any LLM call", () => {
    resetFixtureIds();
    const hash = hashFile(encoder.encode("february statement"));
    const stored = makeDoc({ fileHash: hash, filename: "feb.pdf" });

    const found = findDuplicateUpload(hash, [makeDoc({ fileHash: "a".repeat(64) }), stored]);
    expect(found?.filename).toBe("feb.pdf");
  });

  it("returns null when the file is genuinely new", () => {
    const stored = makeDoc({ fileHash: hashFile(encoder.encode("january")) });
    const incoming = hashFile(encoder.encode("february"));
    expect(findDuplicateUpload(incoming, [stored])).toBeNull();
  });

  it("returns null against an empty library", () => {
    expect(findDuplicateUpload(EMPTY_SHA256, [])).toBeNull();
  });

  it("ignores digest casing and surrounding whitespace", () => {
    const stored = makeDoc({ fileHash: ABC_SHA256.toUpperCase() });
    expect(findDuplicateUpload(`  ${ABC_SHA256}  `, [stored])).toBe(stored);
  });

  it("never matches on a blank hash", () => {
    const stored = makeDoc({ fileHash: "" });
    expect(findDuplicateUpload("", [stored])).toBeNull();
  });

  it("returns the earliest match so the user is always pointed at the original", () => {
    resetFixtureIds();
    const hash = ABC_SHA256;
    const first = makeDoc({ fileHash: hash, filename: "first.pdf" });
    const second = makeDoc({ fileHash: hash, filename: "second.pdf" });
    expect(findDuplicateUpload(hash, [first, second])).toBe(first);
  });
});
