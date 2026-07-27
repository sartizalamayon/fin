import { normaliseDigits } from "../core/money";

/**
 * Merchant / counterparty string comparison.
 *
 * The same transaction is described differently by every channel:
 *
 *   statement : "BKASH*PAYMENT SHWAPNO LTD  TrxID 8H2K9LMN01"
 *   sms       : "Payment to SHWAPNO LTD is successful"
 *
 * ...so a raw string equality check is useless. But the opposite failure is far
 * worse: two ৳50 rickshaw fares on the same day are two real transactions, and
 * over-eager normalisation that flattens "Rickshaw to office" and "Rickshaw to
 * Mirpur" into the same token set would silently delete one of them.
 *
 * The rule this file follows: strip only tokens that carry NO identity —
 * channel branding, structural filler, and ref numbers that are explicitly
 * labelled as ref numbers. Anything that could distinguish two transactions
 * (phone numbers, shop names, digits that are not ref-labelled) is KEPT, even
 * at the cost of missing a real duplicate. Missed duplicates are visible to the
 * user and fixable; wrongly merged transactions are silent and permanent.
 */

/** Channel branding. Provider identity is matched exactly elsewhere, so these
 * tokens are pure noise inside a description. */
const PROVIDER_TOKENS = new Set([
  "bkash",
  "bkas",
  "bikash",
  "nagad",
  "nogod",
  "rocket",
  "upay",
  "tap",
  "mfs",
]);

/** Structural filler and unit words. Deliberately excludes words that change
 * what a row IS — "fee" and "charge" stay, because a cash-out row and its fee
 * row are two separate transactions of similar shape. */
const NOISE_TOKENS = new Set([
  // ref labels
  "trx", "trxid", "txn", "txnid", "tnx", "trn", "ref", "refno", "reference",
  "rrn", "utr", "id", "no", "num", "number", "tid",
  // currency / amount words
  "tk", "tka", "taka", "bdt", "amount", "amt",
  // english filler
  "the", "a", "an", "and", "to", "from", "for", "of", "at", "on", "in", "is",
  "was", "by", "via", "with", "your", "you", "has", "have", "been", "this",
  "that", "your's",
  // status words that differ purely by channel wording
  "successful", "successfully", "success", "completed", "complete", "done",
]);

/** Tokens that label the NEXT token as a machine reference. */
const REF_LABELS = new Set([
  "trx", "trxid", "txn", "txnid", "tnx", "trn", "ref", "refno", "reference",
  "rrn", "utr", "id", "no", "tid",
]);

/** Everything outside these ranges is separator noise: Latin, ASCII digits and
 * the Bengali block (U+0980–U+09FF) survive, `*`, `#`, `/`, `-`, `.` do not. */
const NON_WORD = /[^a-z0-9\u0980-\u09FF]+/g;

const BD_MOBILE = /^(?:88)?01\d{9}$/;

function hasLetter(token: string): boolean {
  return /[a-z\u0980-\u09FF]/.test(token);
}

function hasDigit(token: string): boolean {
  return /\d/.test(token);
}

/**
 * A token shaped like a provider transaction id — long and mixed alphanumeric,
 * e.g. "8H2K9LMN01". Dropped even when unlabelled, because statements append
 * them to descriptions while SMS alerts do not. Pure-digit strings are NOT
 * matched here: phone numbers and account tails distinguish transactions.
 */
function looksLikeTransactionId(token: string): boolean {
  return token.length >= 8 && hasLetter(token) && hasDigit(token);
}

/** Split a raw description into comparable identity-bearing tokens. */
export function tokenise(input: string | null | undefined): string[] {
  if (input == null) return [];

  const flattened = normaliseDigits(String(input))
    .normalize("NFKC")
    .toLowerCase()
    .replace(NON_WORD, " ")
    .trim();

  if (flattened === "") return [];

  const raw = flattened.split(/\s+/);
  const out: string[] = [];

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (token === "") continue;

    if (PROVIDER_TOKENS.has(token) || NOISE_TOKENS.has(token)) continue;

    // "TrxID 8H2K9LMN01" / "Ref 4471" — the label proved the next token is a
    // machine reference, so drop it whatever it looks like.
    const previous = i > 0 ? raw[i - 1] : null;
    if (previous !== null && REF_LABELS.has(previous) && hasDigit(token)) continue;

    // Keep BD mobile numbers: they are the strongest counterparty signal we get
    // from SMS-sourced rows.
    if (BD_MOBILE.test(token)) {
      out.push(token);
      continue;
    }

    if (looksLikeTransactionId(token)) continue;

    out.push(token);
  }

  return out;
}

/**
 * Canonical form of a description for comparison and display-free matching.
 * Returns "" when nothing identity-bearing survived — callers must treat that
 * as "no evidence", never as "matches another empty string".
 */
export function normaliseDescription(input: string | null | undefined): string {
  return tokenise(input).join(" ");
}

function jaccard(aTokens: readonly string[], bTokens: readonly string[]): number {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  if (value.length < 3) {
    if (value.length > 0) out.add(value);
    return out;
  }
  for (let i = 0; i <= value.length - 3; i += 1) {
    out.add(value.slice(i, i + 3));
  }
  return out;
}

/** Sørensen–Dice over character trigrams — tolerant of suffixes and typos. */
function dice(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const gram of ta) {
    if (tb.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (ta.size + tb.size);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Similarity of two descriptions in 0..1.
 *
 * Combines token Jaccard (word-order insensitive, good for reordered
 * statement columns) with trigram Dice (good for "SHWAPNO" vs "SHWAPNO LTD"),
 * taking the more generous of the two — recall comes from here, safety comes
 * from the high threshold the dedupe engine applies on top.
 *
 * Two strings that normalise to nothing score 0, not 1: absence of evidence is
 * never evidence of a match.
 */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const aTokens = tokenise(a);
  const bTokens = tokenise(b);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const aNorm = aTokens.join(" ");
  const bNorm = bTokens.join(" ");
  if (aNorm === bNorm) return 1;

  return round(Math.max(jaccard(aTokens, bTokens), dice(aNorm, bNorm)));
}
