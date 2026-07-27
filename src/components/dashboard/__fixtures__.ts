import type { Currency, Direction, Transaction } from "@/lib/core/types";

/**
 * A realistic demo ledger so every dashboard component can be built, tested and
 * demoed before the database layer exists.
 *
 * Deliberate properties — several tests depend on them:
 *  - six month buckets, Feb–Jul 2026, where **April holds nothing but an
 *    own-account transfer**. April therefore has to render as a zero month
 *    (gap filling) *and* proves the transfer rule: ৳25,000 moved between the
 *    user's own accounts must not show up as ৳25,000 earned and ৳25,000 spent.
 *  - a matched transfer pair (`transferPairId` on both legs) and an unpaired
 *    row classified `transfer` — the two ways a transfer is recognised.
 *  - multiple providers, categories, fees, and one uncategorised row.
 *  - amounts are integer poisha; ৳1,250.50 is `125050`.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

interface TxnSeed {
  at: string;
  amount: number;
  direction: Direction;
  description: string;
  counterparty?: string | null;
  category?: Transaction["category"];
  provider?: Transaction["provider"];
  accountRef?: string | null;
  fee?: number;
  refId?: string | null;
  transferPairId?: string | null;
}

function txn(seed: TxnSeed): Transaction {
  const id = nextId();
  return {
    id,
    userId: USER_ID,
    documentId: null,
    occurredAt: new Date(seed.at),
    amountMinor: seed.amount,
    direction: seed.direction,
    currency: "BDT",
    refId: seed.refId ?? `TRX${id.slice(-8).toUpperCase()}`,
    counterparty: seed.counterparty ?? null,
    description: seed.description,
    provider: seed.provider ?? "bkash",
    accountRef: seed.accountRef ?? "****4471",
    feeMinor: seed.fee ?? 0,
    balanceAfterMinor: null,
    category: seed.category ?? null,
    rawText: seed.description,
    transferPairId: seed.transferPairId ?? null,
    createdAt: new Date(seed.at),
  };
}

/** Both legs of the April bank -> bKash top-up share this id. */
const APRIL_TRANSFER_PAIR = "22222222-2222-4222-8222-222222222222";
/** Both legs of the July top-up. */
const JULY_TRANSFER_PAIR = "33333333-3333-4333-8333-333333333333";

export const DEMO_CURRENCY: Currency = "BDT";

export const DEMO_TRANSACTIONS: Transaction[] = [
  // ---------------------------------------------------------------- Feb 2026
  txn({
    at: "2026-02-01T09:05:00+06:00",
    amount: 6_500_000,
    direction: "credit",
    description: "Salary February 2026",
    counterparty: "Brain Station 23",
    category: "salary",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-02-02T11:20:00+06:00",
    amount: 1_800_000,
    direction: "debit",
    description: "House rent February",
    counterparty: "Landlord — Mirpur DOHS",
    category: "bills",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-02-05T18:42:00+06:00",
    amount: 342_500,
    direction: "debit",
    description: "Grocery run",
    counterparty: "Shwapno",
    category: "food",
    provider: "card",
  }),
  txn({
    at: "2026-02-11T08:15:00+06:00",
    amount: 28_000,
    direction: "debit",
    description: "Ride to office",
    counterparty: "Uber",
    category: "transport",
  }),
  txn({
    at: "2026-02-18T21:00:00+06:00",
    amount: 79_900,
    direction: "debit",
    description: "Netflix monthly",
    counterparty: "Netflix",
    category: "entertainment",
    provider: "card",
  }),
  txn({
    at: "2026-02-24T13:30:00+06:00",
    amount: 50_000,
    direction: "debit",
    description: "Mobile recharge",
    counterparty: "Grameenphone",
    category: "bills",
  }),

  // ---------------------------------------------------------------- Mar 2026
  txn({
    at: "2026-03-01T09:02:00+06:00",
    amount: 6_500_000,
    direction: "credit",
    description: "Salary March 2026",
    counterparty: "Brain Station 23",
    category: "salary",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-03-02T10:10:00+06:00",
    amount: 1_800_000,
    direction: "debit",
    description: "House rent March",
    counterparty: "Landlord — Mirpur DOHS",
    category: "bills",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-03-06T19:05:00+06:00",
    amount: 289_900,
    direction: "debit",
    description: "Grocery run",
    counterparty: "Meena Bazar",
    category: "food",
    provider: "card",
  }),
  txn({
    at: "2026-03-14T20:35:00+06:00",
    amount: 145_000,
    direction: "debit",
    description: "Dinner with family",
    counterparty: "Sultan's Dine",
    category: "food",
    provider: "card",
  }),
  txn({
    at: "2026-03-19T16:45:00+06:00",
    amount: 96_500,
    direction: "debit",
    description: "Pharmacy",
    counterparty: "Lazz Pharma",
    category: "health",
  }),
  txn({
    at: "2026-03-22T12:00:00+06:00",
    amount: 500_000,
    direction: "debit",
    description: "Send money to Rafi",
    counterparty: "Rafi Ahmed",
    category: "other",
    fee: 925,
  }),
  txn({
    at: "2026-03-22T12:00:30+06:00",
    amount: 925,
    direction: "debit",
    description: "Send money charge",
    counterparty: "bKash",
    category: "fees",
  }),

  // ------------------------------------------------- Apr 2026 — transfers only
  txn({
    at: "2026-04-09T14:00:00+06:00",
    amount: 2_500_000,
    direction: "debit",
    description: "Add Money to bKash wallet",
    counterparty: "Own bKash wallet",
    category: "transfer",
    provider: "bank",
    accountRef: "****8802",
    transferPairId: APRIL_TRANSFER_PAIR,
  }),
  txn({
    at: "2026-04-09T14:00:12+06:00",
    amount: 2_500_000,
    direction: "credit",
    description: "Add Money from City Bank",
    counterparty: "Own City Bank account",
    category: "transfer",
    transferPairId: APRIL_TRANSFER_PAIR,
  }),

  // ---------------------------------------------------------------- May 2026
  txn({
    at: "2026-05-01T09:04:00+06:00",
    amount: 6_500_000,
    direction: "credit",
    description: "Salary May 2026",
    counterparty: "Brain Station 23",
    category: "salary",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-05-02T10:25:00+06:00",
    amount: 1_800_000,
    direction: "debit",
    description: "House rent May",
    counterparty: "Landlord — Mirpur DOHS",
    category: "bills",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-05-07T15:12:00+06:00",
    amount: 1_249_900,
    direction: "debit",
    description: "Laptop stand + monitor arm",
    counterparty: "Daraz",
    category: "shopping",
    provider: "card",
  }),
  txn({
    at: "2026-05-12T11:00:00+06:00",
    amount: 900_000,
    direction: "debit",
    description: "Semester tuition instalment",
    counterparty: "BRAC University",
    category: "education",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-05-16T08:40:00+06:00",
    amount: 32_000,
    direction: "debit",
    description: "Pathao bike",
    counterparty: "Pathao",
    category: "transport",
  }),
  txn({
    at: "2026-05-21T13:15:00+06:00",
    amount: 78_000,
    direction: "debit",
    description: "Lunch",
    counterparty: "Chillox",
    category: "food",
  }),
  txn({
    at: "2026-05-28T17:30:00+06:00",
    amount: 220_000,
    direction: "debit",
    description: "Cash out at agent",
    counterparty: "bKash agent — Mirpur 12",
    category: "cash",
    fee: 4_070,
  }),

  // ---------------------------------------------------------------- Jun 2026
  txn({
    at: "2026-06-01T09:03:00+06:00",
    amount: 6_500_000,
    direction: "credit",
    description: "Salary June 2026",
    counterparty: "Brain Station 23",
    category: "salary",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-06-04T19:45:00+06:00",
    amount: 1_800_000,
    direction: "debit",
    description: "House rent June",
    counterparty: "Landlord — Mirpur DOHS",
    category: "bills",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-06-08T12:30:00+06:00",
    amount: 1_150_000,
    direction: "credit",
    description: "Freelance milestone — landing page",
    counterparty: "Upwork",
    category: "other",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-06-09T20:10:00+06:00",
    amount: 165_000,
    direction: "debit",
    description: "Burger night",
    counterparty: "Takeout",
    category: "food",
    provider: "card",
  }),
  txn({
    at: "2026-06-13T18:20:00+06:00",
    amount: 412_000,
    direction: "debit",
    description: "Weekly grocery",
    counterparty: "Shwapno",
    category: "food",
    provider: "card",
  }),
  txn({
    at: "2026-06-17T21:40:00+06:00",
    amount: 130_000,
    direction: "debit",
    description: "Cinema — two tickets",
    counterparty: "Star Cineplex",
    category: "entertainment",
    provider: "card",
  }),
  txn({
    at: "2026-06-23T10:05:00+06:00",
    amount: 350_000,
    direction: "debit",
    description: "Dental check-up",
    counterparty: "Dhaka Dental",
    category: "health",
  }),
  txn({
    at: "2026-06-27T09:15:00+06:00",
    amount: 45_500,
    direction: "debit",
    description: "CNG fare",
    counterparty: null,
    category: "transport",
  }),

  // ---------------------------------------------------------------- Jul 2026
  txn({
    at: "2026-07-01T09:01:00+06:00",
    amount: 6_500_000,
    direction: "credit",
    description: "Salary July 2026",
    counterparty: "Brain Station 23",
    category: "salary",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-07-02T11:30:00+06:00",
    amount: 1_800_000,
    direction: "debit",
    description: "House rent July",
    counterparty: "Landlord — Mirpur DOHS",
    category: "bills",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-07-03T13:45:00+06:00",
    amount: 1_500_000,
    direction: "debit",
    description: "Add Money to bKash wallet",
    counterparty: "Own bKash wallet",
    category: "transfer",
    provider: "bank",
    accountRef: "****8802",
    transferPairId: JULY_TRANSFER_PAIR,
  }),
  txn({
    at: "2026-07-03T13:45:09+06:00",
    amount: 1_500_000,
    direction: "credit",
    description: "Add Money from City Bank",
    counterparty: "Own City Bank account",
    category: "transfer",
    transferPairId: JULY_TRANSFER_PAIR,
  }),
  txn({
    at: "2026-07-05T19:20:00+06:00",
    amount: 386_000,
    direction: "debit",
    description: "Weekly grocery",
    counterparty: "Meena Bazar",
    category: "food",
    provider: "card",
  }),
  txn({
    at: "2026-07-07T08:35:00+06:00",
    amount: 24_000,
    direction: "debit",
    description: "Ride to office",
    counterparty: "Uber",
    category: "transport",
  }),
  txn({
    at: "2026-07-09T14:05:00+06:00",
    amount: 79_900,
    direction: "debit",
    description: "Netflix monthly",
    counterparty: "Netflix",
    category: "entertainment",
    provider: "card",
  }),
  txn({
    at: "2026-07-11T20:55:00+06:00",
    amount: 212_500,
    direction: "debit",
    description: "Iftar with cousins",
    counterparty: "Kacchi Bhai",
    category: "food",
    provider: "card",
  }),
  txn({
    at: "2026-07-13T16:10:00+06:00",
    amount: 645_000,
    direction: "debit",
    description: "Eid shirt + shoes",
    counterparty: "Aarong",
    category: "shopping",
    provider: "card",
  }),
  txn({
    at: "2026-07-15T10:00:00+06:00",
    amount: 92_000,
    direction: "debit",
    description: "Electricity bill",
    counterparty: "DPDC",
    category: "bills",
  }),
  txn({
    at: "2026-07-17T09:25:00+06:00",
    amount: 38_500,
    direction: "debit",
    description: "Pathao bike",
    counterparty: "Pathao",
    category: "transport",
  }),
  txn({
    at: "2026-07-18T12:40:00+06:00",
    amount: 1_150_000,
    direction: "credit",
    description: "Freelance milestone — dashboard build",
    counterparty: "Upwork",
    category: "other",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-07-19T18:30:00+06:00",
    amount: 300_000,
    direction: "debit",
    description: "Cash out at agent",
    counterparty: "bKash agent — Mirpur 12",
    category: "cash",
    fee: 5_550,
  }),
  txn({
    at: "2026-07-19T18:30:20+06:00",
    amount: 5_550,
    direction: "debit",
    description: "Cash out charge",
    counterparty: "bKash",
    category: "fees",
  }),
  txn({
    at: "2026-07-21T15:15:00+06:00",
    amount: 158_000,
    direction: "debit",
    description: "Pharmacy — monthly meds",
    counterparty: "Lazz Pharma",
    category: "health",
  }),
  txn({
    at: "2026-07-22T11:05:00+06:00",
    amount: 400_000,
    direction: "debit",
    description: "Moved savings to DPS",
    counterparty: "Own DPS account",
    // No pair uploaded yet — the `transfer` category alone must exclude it.
    category: "transfer",
    provider: "bank",
    accountRef: "****8802",
  }),
  txn({
    at: "2026-07-24T17:50:00+06:00",
    amount: 64_000,
    direction: "debit",
    description: "POS 4471 DHAKA BD",
    counterparty: null,
    // Uncategorised on purpose — must fall into `other`, never be dropped.
    category: null,
    provider: "card",
  }),
];

/** The month the demo data ends in — what the dashboard opens on. */
export const DEMO_LATEST_MONTH = "2026-07";

/** A brand-new user. Every component must survive this. */
export const NO_TRANSACTIONS: Transaction[] = [];
