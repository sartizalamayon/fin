import { createHash } from "node:crypto";

/**
 * File-level deduplication.
 *
 * This is the cheapest and most certain check in the whole ingestion pipeline:
 * the same bytes can only ever describe the same transactions. It runs BEFORE
 * any text extraction or LLM call, because those cost money and latency, and a
 * user re-uploading "bkash-statement.pdf" a second time is common (they forget,
 * or the first upload appeared to fail).
 */

/** SHA-256 of the uploaded bytes as lowercase hex. Matches `Document.fileHash`. */
export function hashFile(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Minimum shape needed to spot a re-upload — `StatementDocument` satisfies it. */
export interface HashedDocument {
  id: string;
  fileHash: string;
}

/**
 * Find an already-stored document with identical bytes.
 *
 * Returns the FIRST match in input order so the caller can point the user at
 * the original upload deterministically. Comparison is case-insensitive on the
 * hex digest because different writers disagree about digest casing.
 */
export function findDuplicateUpload<T extends HashedDocument>(
  fileHash: string,
  existingDocs: readonly T[],
): T | null {
  const needle = fileHash.trim().toLowerCase();
  if (needle === "") return null;

  for (const doc of existingDocs) {
    if (doc.fileHash?.trim().toLowerCase() === needle) return doc;
  }
  return null;
}
