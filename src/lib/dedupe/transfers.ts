import type { Transaction, TransferCandidate } from "../core/types";
import { normaliseDescription, similarity } from "./similarity";

/**
 * Own-account transfer detection.
 *
 * "Add Money" from a bank card into bKash produces two rows: a debit on the
 * card and a credit in the wallet. Both are real ledger entries, but together
 * they are ONE movement of the user's own money. Counted naively they inflate
 * income and spending at the same time — a user who tops up ৳10,000 every month
 * appears to earn ৳10,000 more and spend ৳10,000 more than they do, which
 * poisons every budget, average and category chart in the app.
 *
 * These are NOT duplicates and must never be deleted. Both rows are kept and
 * linked via `Transaction.transferPairId` so analytics can net them to zero.
 *
 * Note the shape of the signal is the exact opposite of a duplicate: a
 * duplicate is the SAME direction on the SAME provider, a transfer is OPPOSITE
 * directions on DIFFERENT providers. The two detectors cannot fight over a row.
 */

/**
 * Legs are near-simultaneous in practice — the wallet credit lands within
 * seconds. 90 minutes covers batch-posted bank debits and clock skew between a
 * bank host and an MFS host without reaching into unrelated activity.
 */
export const DEFAULT_TRANSFER_WINDOW_MS = 90 * 60 * 1000;

/** bKash cash-out is 1.85%, Nagad 1.5% — 2% covers every published MFS rate. */
export const DEFAULT_FEE_RATE = 0.02;

/** Flat floor, so a ৳5 send-money fee on a ৳100 transfer still reconciles. */
export const DEFAULT_FLAT_FEE_MINOR = 10_00;

/** Hard ceiling, so a large transfer cannot wander onto an unrelated row. */
export const DEFAULT_MAX_FEE_MINOR = 1_000_00;

/**
 * Floor for reporting a pair.
 *
 * Note this is a ranking bar, not the safety mechanism. Matching amounts and
 * close timing alone can score well above it — a salary landing while rent
 * leaves does — so linking additionally REQUIRES positive evidence of a
 * self-transfer (see findTransferPairs). Confidence only orders the survivors.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.6;

const BASE_CONFIDENCE = 0.55;

/** Words either leg uses when it is a self-transfer rather than a payment. */
const TRANSFER_VOCABULARY = [
  "add money",
  "addmoney",
  "cash in",
  "cashin",
  "cash out",
  "cashout",
  "send money",
  "sendmoney",
  "money in",
  "transfer",
  "fund transfer",
  "self",
  "own account",
  "top up",
  "topup",
  "recharge wallet",
  "wallet",
  "npsb",
  "eft",
  "beftn",
  "b2c",
  "ক্যাশ", // ক্যাশ (cash)
  "যোগ", // যোগ (add)
  "ট্রান্সফার", // ট্রান্সফার
];

export interface TransferOptions {
  /** Max |occurredAt| gap between the two legs. Default 90 minutes. */
  windowMs?: number;
  /** Share of the transfer a fee may account for. Default 0.02. */
  feeRate?: number;
  /** Minimum fee allowance in minor units regardless of size. Default ৳10. */
  flatFeeMinor?: number;
  /** Maximum fee allowance in minor units. Default ৳1,000. */
  maxFeeMinor?: number;
  /** Pairs scoring below this are not reported. Default 0.6. */
  minConfidence?: number;
  /**
   * Re-examine rows that already carry a `transferPairId`. Off by default so
   * incremental runs do not re-pair settled rows.
   */
  includeAlreadyPaired?: boolean;
}

/** `TransferCandidate` plus the detail the UI and tests need. */
export interface TransferPairDetail extends TransferCandidate {
  /** Minor-unit difference the fee had to explain. 0 for an exact match. */
  feeGapMinor: number;
  /** Milliseconds between the two legs. */
  gapMs: number;
  /** Human-readable justification, for the "why is this linked?" tooltip. */
  reason: string;
}

function timeOf(value: Date): number {
  return new Date(value).getTime();
}

/**
 * How much of a mismatch a provider fee can plausibly explain for a transfer of
 * this size: a percentage, floored at a flat minimum and capped absolutely.
 */
export function allowedFeeGapMinor(
  principalMinor: number,
  opts: { feeRate: number; flatFeeMinor: number; maxFeeMinor: number },
): number {
  const proportional = Math.ceil(Math.abs(principalMinor) * opts.feeRate);
  return Math.min(opts.maxFeeMinor, Math.max(opts.flatFeeMinor, proportional));
}

/**
 * Words a statement uses for each provider. `bank` is deliberately absent: it
 * is too generic to be evidence of anything ("BANK CHARGE", "BANK OF ...").
 */
const PROVIDER_WORDS: Record<string, string[]> = {
  bkash: ["bkash", "bikash"],
  nagad: ["nagad", "nogod"],
  rocket: ["rocket"],
  upay: ["upay"],
  card: ["card", "visa", "mastercard"],
};

/** Does this text name the given provider — i.e. the other end of the move? */
function mentionsProvider(
  text: string | null | undefined,
  provider: string,
): boolean {
  const words = PROVIDER_WORDS[provider];
  if (!words) return false;

  const normalised = normaliseDescription(text);
  if (normalised === "") return false;

  return words.some((word) => normalised.includes(word));
}

/**
 * True when both legs name a real, and clearly different, counterparty.
 *
 * You do not pay two unrelated third parties to move money between your own
 * accounts, so this pattern is a payment pair, not a transfer.
 */
function namesDifferentThirdParties(
  a: { counterparty: string | null },
  b: { counterparty: string | null },
): boolean {
  const left = normaliseDescription(a.counterparty);
  const right = normaliseDescription(b.counterparty);
  if (left === "" || right === "") return false;

  return similarity(a.counterparty, b.counterparty) < 0.5;
}

function hasTransferVocabulary(...texts: (string | null | undefined)[]): boolean {
  for (const text of texts) {
    const normalised = normaliseDescription(text);
    if (normalised === "") continue;
    for (const phrase of TRANSFER_VOCABULARY) {
      if (normalised.includes(phrase)) return true;
    }
  }
  return false;
}

interface GapResult {
  gap: number;
  /** True when a declared `feeMinor` on one leg explains the gap exactly. */
  explainedByDeclaredFee: boolean;
}

/**
 * Smallest unexplained difference between what left one account and what
 * arrived in the other.
 *
 * Sources disagree about where the fee lives. A ৳1,000 top-up with a ৳18.50 fee
 * is written either as `amount 1000, fee 18.50` (fee in its own column) or as
 * `amount 1018.50, fee 0` (fee folded into the amount), and the receiving side
 * usually just says `1000`. All three readings are tried.
 */
function amountGap(debit: Transaction, credit: Transaction): GapResult {
  const debitFee = debit.feeMinor ?? 0;
  const creditFee = credit.feeMinor ?? 0;

  const candidates = [
    Math.abs(debit.amountMinor - credit.amountMinor),
    Math.abs(debit.amountMinor + debitFee - credit.amountMinor),
    Math.abs(debit.amountMinor - (credit.amountMinor + creditFee)),
    Math.abs(debit.amountMinor + debitFee - (credit.amountMinor + creditFee)),
  ];

  const gap = Math.min(...candidates);
  const raw = Math.abs(debit.amountMinor - credit.amountMinor);
  const explainedByDeclaredFee =
    raw > 0 && ((debitFee > 0 && raw === debitFee) || (creditFee > 0 && raw === creditFee));

  return { gap, explainedByDeclaredFee };
}

interface ScoredPair extends TransferPairDetail {
  outIndex: number;
  inIndex: number;
}

/**
 * Find pairs of rows that are the two legs of one own-account movement.
 *
 * Gates (all required): opposite directions, different providers, same
 * currency, non-zero amount, timestamps within the window, and an amount
 * difference no bigger than a plausible provider fee.
 *
 * Scoring then ranks the survivors, and pairing is greedy over that ranking so
 * that no row is ever used twice — a wallet credit cannot net out two different
 * card debits.
 *
 * `outLegRefId` / `inLegRefId` carry `Transaction.id`, not `Transaction.refId`:
 * `refId` is nullable (SMS-sourced rows often have none) while the contract
 * demands a string, and the id is what the caller writes into
 * `transferPairId` on both legs.
 */
export function findTransferPairs(
  transactions: readonly Transaction[],
  options: TransferOptions = {},
): TransferPairDetail[] {
  const opts = {
    windowMs: options.windowMs ?? DEFAULT_TRANSFER_WINDOW_MS,
    feeRate: options.feeRate ?? DEFAULT_FEE_RATE,
    flatFeeMinor: options.flatFeeMinor ?? DEFAULT_FLAT_FEE_MINOR,
    maxFeeMinor: options.maxFeeMinor ?? DEFAULT_MAX_FEE_MINOR,
    minConfidence: options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
    includeAlreadyPaired: options.includeAlreadyPaired ?? false,
  };

  const usable = transactions
    .map((transaction, index) => ({ transaction, index }))
    .filter(({ transaction }) => {
      if (!transaction) return false;
      if (!opts.includeAlreadyPaired && transaction.transferPairId != null) return false;
      if (transaction.amountMinor <= 0) return false;
      return Number.isFinite(timeOf(transaction.occurredAt));
    });

  const debits = usable.filter((e) => e.transaction.direction === "debit");
  const credits = usable
    .filter((e) => e.transaction.direction === "credit")
    .map((e) => ({ ...e, time: timeOf(e.transaction.occurredAt) }))
    .sort((a, b) => a.time - b.time || a.index - b.index);

  /** First credit at or after `target` in the time-sorted list. */
  const lowerBound = (target: number): number => {
    let lo = 0;
    let hi = credits.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (credits[mid].time < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const scored: ScoredPair[] = [];

  for (const out of debits) {
    const debit = out.transaction;
    const debitTime = timeOf(debit.occurredAt);

    for (
      let c = lowerBound(debitTime - opts.windowMs);
      c < credits.length && credits[c].time <= debitTime + opts.windowMs;
      c += 1
    ) {
      const into = credits[c];
      const credit = into.transaction;

      if (debit.id === credit.id) continue;
      if (debit.provider === credit.provider) continue;
      if (debit.currency !== credit.currency) continue;

      const gapMs = Math.abs(debitTime - into.time);

      const { gap, explainedByDeclaredFee } = amountGap(debit, credit);
      const principal = Math.min(debit.amountMinor, credit.amountMinor);
      const allowed = allowedFeeGapMinor(principal, opts);
      if (gap > allowed) continue;

      // --- self-transfer evidence (required, not merely scored) ----------
      //
      // Opposite directions, matching amounts and closeness in time are also
      // exactly what a COINCIDENCE looks like: a salary landing in the bank
      // while rent leaves the wallet ten minutes later satisfies all three.
      // Treating that as a transfer erases real income AND real spending from
      // every chart at once, and because the net stays right, nothing looks
      // wrong. So something must positively say "the user moved their own
      // money" before these two rows are linked.
      const vocabulary = hasTransferVocabulary(
        debit.description,
        credit.description,
        debit.counterparty,
        credit.counterparty,
      );
      const namesCounterProvider =
        mentionsProvider(debit.description, credit.provider) ||
        mentionsProvider(debit.counterparty, credit.provider) ||
        mentionsProvider(credit.description, debit.provider) ||
        mentionsProvider(credit.counterparty, debit.provider);
      // A gap that lands exactly on the fee the statement itself declares is
      // hard to produce by chance; a plain exact match is not evidence at all.
      const feeExplained = gap > 0 && explainedByDeclaredFee;

      if (!vocabulary && !namesCounterProvider && !feeExplained) continue;

      // Two different named third parties cannot both be the user. Skipped when
      // a leg names the other provider, since "bKash"/"BRAC Bank" are distinct
      // strings that legitimately describe the two ends of one movement.
      if (!namesCounterProvider && namesDifferentThirdParties(debit, credit)) {
        continue;
      }

      // --- confidence ---------------------------------------------------
      let confidence = BASE_CONFIDENCE;
      const reasons: string[] = [];

      if (gap === 0) {
        confidence += 0.2;
        reasons.push("amounts match exactly");
      } else if (explainedByDeclaredFee) {
        confidence += 0.16;
        reasons.push("difference equals the declared fee");
      } else {
        confidence += 0.02 + 0.1 * (1 - gap / allowed);
        reasons.push("difference within the expected fee band");
      }

      const closeness = 1 - gapMs / opts.windowMs;
      confidence += 0.15 * closeness;
      reasons.push(`${Math.round(gapMs / 60_000)} min apart`);

      if (vocabulary) {
        confidence += 0.1;
        reasons.push("transfer wording on at least one leg");
      }

      if (namesCounterProvider) {
        confidence += 0.08;
        reasons.push("one leg names the other account");
      }

      confidence = Math.round(Math.min(1, Math.max(0, confidence)) * 1000) / 1000;
      if (confidence < opts.minConfidence) continue;

      scored.push({
        outLegRefId: debit.id,
        inLegRefId: credit.id,
        amountMinor: principal,
        confidence,
        feeGapMinor: gap,
        gapMs,
        reason: `${debit.provider} → ${credit.provider}: ${reasons.join(", ")}`,
        outIndex: out.index,
        inIndex: into.index,
      });
    }
  }

  // Greedy, highest confidence first. Ties break on the tighter time gap, then
  // on ids, so the output never depends on iteration order.
  scored.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.gapMs - b.gapMs ||
      a.feeGapMinor - b.feeGapMinor ||
      (a.outLegRefId < b.outLegRefId ? -1 : a.outLegRefId > b.outLegRefId ? 1 : 0) ||
      (a.inLegRefId < b.inLegRefId ? -1 : a.inLegRefId > b.inLegRefId ? 1 : 0),
  );

  const used = new Set<number>();
  const pairs: TransferPairDetail[] = [];

  for (const pair of scored) {
    if (used.has(pair.outIndex) || used.has(pair.inIndex)) continue;
    used.add(pair.outIndex);
    used.add(pair.inIndex);
    pairs.push({
      outLegRefId: pair.outLegRefId,
      inLegRefId: pair.inLegRefId,
      amountMinor: pair.amountMinor,
      confidence: pair.confidence,
      feeGapMinor: pair.feeGapMinor,
      gapMs: pair.gapMs,
      reason: pair.reason,
    });
  }

  return pairs;
}

/**
 * Ids of every row that is one leg of a detected transfer — what analytics
 * excludes (or nets to zero) when computing income and spending.
 */
export function transferLegIds(pairs: readonly TransferCandidate[]): Set<string> {
  const ids = new Set<string>();
  for (const pair of pairs) {
    ids.add(pair.outLegRefId);
    ids.add(pair.inLegRefId);
  }
  return ids;
}
