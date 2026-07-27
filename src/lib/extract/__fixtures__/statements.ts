/**
 * Statement fixtures.
 *
 * Each fixture is a whole, self-consistent document: the rendered lines a real
 * statement would print, and the JSON an LLM would return for them. The lines
 * feed both `MockLlmProvider` (which matches on them) and `makePdf` (which
 * renders them into real PDF bytes), so the end-to-end test exercises the same
 * bytes -> text -> rows path production does, with no network.
 *
 * `expected` is checked by the tests, so the arithmetic in these fixtures is
 * itself under test — a typo in an amount fails the suite rather than silently
 * weakening it.
 */

import type { ReconcileStatus } from "@/lib/core/types";

export interface StatementFixture {
  id: string;
  label: string;
  /**
   * Distinctive strings that must all appear in the input for the mock provider
   * to claim this fixture. Compared with whitespace collapsed, so they survive
   * the PDF round-trip.
   */
  match: string[];
  /** Statement lines as column segments. Empty segments are blank cells. */
  lines: string[][];
  /** X position per column when rendered to PDF. Test layout only. */
  columnX: number[];
  fontSize: number;
  /** Verbatim model output, unvalidated — the mock runs it through the schema. */
  extraction: unknown;
  expected: { status: ReconcileStatus; deltaMinor: number };
}

/** Render a fixture's lines the way `pdf.ts` renders a real page. */
export function fixtureText(fixture: StatementFixture): string {
  return fixture.lines.map(fixtureLine).join("\n");
}

/** One line, blank cells dropped and columns separated the way pdf.ts does. */
export function fixtureLine(segments: readonly string[]): string {
  return segments.filter((segment) => segment !== "").join("   ");
}

const BKASH_COLUMNS = [36, 120, 175, 245, 345, 400, 450];
const BANK_COLUMNS = [40, 110, 300, 380, 445, 515];

// ---------------------------------------------------------------------------
// 1. A clean bKash statement: fees on send money and cash out, balances agree.
// ---------------------------------------------------------------------------

const BKASH_CLEAN_LINES: string[][] = [
  ["bKash Limited"],
  ["Account Statement"],
  ["Account No: 01712****89"],
  ["Statement Period: 01/03/2026 - 31/03/2026"],
  ["Opening Balance: 3,250.00 BDT"],
  ["Date & Time", "Trx ID", "Trx Type", "Details", "Amount", "Fee", "Balance"],
  [
    "02/03/2026 10:14 AM",
    "CGA4X1B2N9",
    "Cash In",
    "From Agent 01911223344",
    "+2,000.00",
    "0.00",
    "5,250.00",
  ],
  [
    "05/03/2026 06:41 PM",
    "CGB7Y2C3P1",
    "Send Money",
    "To 01812345678",
    "-1,500.00",
    "5.00",
    "3,745.00",
  ],
  [
    "11/03/2026 01:07 PM",
    "CGC9Z3D4Q2",
    "Payment",
    "Shwapno Dhanmondi",
    "-845.50",
    "0.00",
    "2,899.50",
  ],
  [
    "19/03/2026 09:22 AM",
    "CGD2A4E5R3",
    "Mobile Recharge",
    "01712000089",
    "-300.00",
    "0.00",
    "2,599.50",
  ],
  [
    "27/03/2026 11:58 AM",
    "CGE5B6F7S4",
    "Cash Out",
    "Agent 01911999888",
    "-1,000.00",
    "18.50",
    "1,581.00",
  ],
  ["Closing Balance: 1,581.00 BDT"],
];

export const BKASH_CLEAN: StatementFixture = {
  id: "bkash-clean",
  label: "bKash wallet statement, March 2026, reconciles exactly",
  match: ["bKash Limited", "CGA4X1B2N9"],
  lines: BKASH_CLEAN_LINES,
  columnX: BKASH_COLUMNS,
  fontSize: 7,
  extraction: {
    provider: "bkash",
    accountRef: "01712****89",
    currency: "BDT",
    periodStart: "01/03/2026",
    periodEnd: "31/03/2026",
    // 3,250.00 in, 1,581.00 out: 325000 + 200000 - 364550 - 2350 = 158100
    openingBalanceMinor: 325000,
    closingBalanceMinor: 158100,
    rows: [
      {
        occurredAt: "2026-03-02T10:14:00+06:00",
        amountMinor: 200000,
        direction: "credit",
        currency: "BDT",
        refId: "CGA4X1B2N9",
        counterparty: "Agent 01911223344",
        description: "Cash In",
        provider: "bkash",
        accountRef: "01712****89",
        feeMinor: 0,
        balanceAfterMinor: 525000,
        rawText: fixtureLine(BKASH_CLEAN_LINES[6]),
      },
      {
        occurredAt: "2026-03-05T18:41:00+06:00",
        amountMinor: 150000,
        direction: "debit",
        currency: "BDT",
        refId: "CGB7Y2C3P1",
        counterparty: "01812345678",
        description: "Send Money",
        provider: "bkash",
        accountRef: "01712****89",
        feeMinor: 500,
        balanceAfterMinor: 374500,
        rawText: fixtureLine(BKASH_CLEAN_LINES[7]),
      },
      {
        occurredAt: "2026-03-11T13:07:00+06:00",
        amountMinor: 84550,
        direction: "debit",
        currency: "BDT",
        refId: "CGC9Z3D4Q2",
        counterparty: "Shwapno Dhanmondi",
        description: "Payment",
        provider: "bkash",
        accountRef: "01712****89",
        feeMinor: 0,
        balanceAfterMinor: 289950,
        rawText: fixtureLine(BKASH_CLEAN_LINES[8]),
      },
      {
        occurredAt: "2026-03-19T09:22:00+06:00",
        amountMinor: 30000,
        direction: "debit",
        currency: "BDT",
        refId: "CGD2A4E5R3",
        counterparty: "01712000089",
        description: "Mobile Recharge",
        provider: "bkash",
        accountRef: "01712****89",
        feeMinor: 0,
        balanceAfterMinor: 259950,
        rawText: fixtureLine(BKASH_CLEAN_LINES[9]),
      },
      {
        occurredAt: "2026-03-27T11:58:00+06:00",
        amountMinor: 100000,
        direction: "debit",
        currency: "BDT",
        refId: "CGE5B6F7S4",
        counterparty: "Agent 01911999888",
        description: "Cash Out",
        provider: "bkash",
        accountRef: "01712****89",
        feeMinor: 1850,
        balanceAfterMinor: 158100,
        rawText: fixtureLine(BKASH_CLEAN_LINES[10]),
      },
    ],
  },
  expected: { status: "verified", deltaMinor: 0 },
};

// ---------------------------------------------------------------------------
// 2. A clean bank statement: separate debit/credit columns, a service charge
//    that IS its own transaction row (unlike an MFS fee).
// ---------------------------------------------------------------------------

const BANK_CLEAN_LINES: string[][] = [
  ["BRAC BANK PLC"],
  ["Statement of Account"],
  ["Account Number: ****4471"],
  ["Currency: BDT"],
  ["Period: 01/02/2026 to 28/02/2026"],
  ["Opening Balance: 84,120.75"],
  ["Date", "Particulars", "Reference", "Debit", "Credit", "Balance"],
  [
    "03/02/2026",
    "ATM CASH WITHDRAWAL GULSHAN 1",
    "ATM99120",
    "5,000.00",
    "",
    "79,120.75",
  ],
  [
    "07/02/2026",
    "EFTN CREDIT SALARY FEB 2026",
    "EFT771203",
    "",
    "65,000.00",
    "144,120.75",
  ],
  [
    "14/02/2026",
    "POS PURCHASE AGORA BANANI",
    "POS55012",
    "3,412.25",
    "",
    "140,708.50",
  ],
  [
    "21/02/2026",
    "ONLINE TRF TO BKASH WALLET",
    "IBFT30119",
    "10,000.00",
    "",
    "130,708.50",
  ],
  ["26/02/2026", "SERVICE CHARGE Q1 2026", "SVC00021", "575.00", "", "130,133.50"],
  ["Closing Balance: 130,133.50"],
];

export const BANK_CLEAN: StatementFixture = {
  id: "bank-clean",
  label: "BRAC Bank statement, February 2026, reconciles exactly",
  match: ["BRAC BANK PLC", "ATM99120"],
  lines: BANK_CLEAN_LINES,
  columnX: BANK_COLUMNS,
  fontSize: 7,
  extraction: {
    provider: "bank",
    accountRef: "****4471",
    currency: "BDT",
    periodStart: "01/02/2026",
    periodEnd: "28/02/2026",
    // 8412075 + 6500000 - 1898725 - 0 = 13013350
    openingBalanceMinor: 8412075,
    closingBalanceMinor: 13013350,
    rows: [
      {
        occurredAt: "2026-02-03T00:00:00+06:00",
        amountMinor: 500000,
        direction: "debit",
        currency: "BDT",
        refId: "ATM99120",
        counterparty: "ATM Gulshan 1",
        description: "ATM cash withdrawal",
        provider: "bank",
        accountRef: "****4471",
        feeMinor: 0,
        balanceAfterMinor: 7912075,
        rawText: fixtureLine(BANK_CLEAN_LINES[7]),
      },
      {
        occurredAt: "2026-02-07T00:00:00+06:00",
        amountMinor: 6500000,
        direction: "credit",
        currency: "BDT",
        refId: "EFT771203",
        counterparty: "EFTN salary credit",
        description: "Salary February 2026",
        provider: "bank",
        accountRef: "****4471",
        feeMinor: 0,
        balanceAfterMinor: 14412075,
        rawText: fixtureLine(BANK_CLEAN_LINES[8]),
      },
      {
        occurredAt: "2026-02-14T00:00:00+06:00",
        amountMinor: 341225,
        direction: "debit",
        currency: "BDT",
        refId: "POS55012",
        counterparty: "Agora Banani",
        description: "POS purchase",
        provider: "bank",
        accountRef: "****4471",
        feeMinor: 0,
        balanceAfterMinor: 14070850,
        rawText: fixtureLine(BANK_CLEAN_LINES[9]),
      },
      {
        occurredAt: "2026-02-21T00:00:00+06:00",
        amountMinor: 1000000,
        direction: "debit",
        currency: "BDT",
        refId: "IBFT30119",
        counterparty: "bKash wallet",
        description: "Online transfer to bKash",
        provider: "bank",
        accountRef: "****4471",
        feeMinor: 0,
        balanceAfterMinor: 13070850,
        rawText: fixtureLine(BANK_CLEAN_LINES[10]),
      },
      {
        occurredAt: "2026-02-26T00:00:00+06:00",
        amountMinor: 57500,
        direction: "debit",
        currency: "BDT",
        refId: "SVC00021",
        counterparty: "BRAC Bank PLC",
        description: "Service charge Q1 2026",
        provider: "bank",
        accountRef: "****4471",
        feeMinor: 0,
        balanceAfterMinor: 13013350,
        rawText: fixtureLine(BANK_CLEAN_LINES[11]),
      },
    ],
  },
  expected: { status: "verified", deltaMinor: 0 },
};

// ---------------------------------------------------------------------------
// 3. The one that must fail: a 2,750.25 payment extracted as a credit.
//    The gap comes out at exactly twice the row's effect, which is the
//    signature findLikelyCulprits reads as a flipped direction.
// ---------------------------------------------------------------------------

const BKASH_BROKEN_LINES: string[][] = [
  ["bKash Limited"],
  ["Account Statement"],
  ["Account No: 01988****12"],
  ["Statement Period: 01/05/2026 - 31/05/2026"],
  ["Opening Balance: 6,000.00 BDT"],
  ["Date & Time", "Trx ID", "Trx Type", "Details", "Amount", "Fee", "Balance"],
  [
    "04/05/2026 08:30 AM",
    "BKQ1W2E3R4",
    "Cash In",
    "From Agent 01711000111",
    "+4,000.00",
    "0.00",
    "10,000.00",
  ],
  [
    "09/05/2026 07:15 PM",
    "BKT5Y6U7I8",
    "Payment",
    "Chaldal Online",
    "-2,750.25",
    "0.00",
    "7,249.75",
  ],
  [
    "18/05/2026 12:03 PM",
    "BKO9P0A1S2",
    "Send Money",
    "To 01677889900",
    "-1,000.00",
    "5.00",
    "6,244.75",
  ],
  ["Closing Balance: 6,244.75 BDT"],
];

export const BKASH_BROKEN: StatementFixture = {
  id: "bkash-broken",
  label: "bKash statement with a flipped direction — must fail reconciliation",
  match: ["bKash Limited", "BKQ1W2E3R4"],
  lines: BKASH_BROKEN_LINES,
  columnX: BKASH_COLUMNS,
  fontSize: 7,
  extraction: {
    provider: "bkash",
    accountRef: "01988****12",
    currency: "BDT",
    periodStart: "01/05/2026",
    periodEnd: "31/05/2026",
    openingBalanceMinor: 600000,
    closingBalanceMinor: 624475,
    rows: [
      {
        occurredAt: "2026-05-04T08:30:00+06:00",
        amountMinor: 400000,
        direction: "credit",
        currency: "BDT",
        refId: "BKQ1W2E3R4",
        counterparty: "Agent 01711000111",
        description: "Cash In",
        provider: "bkash",
        accountRef: "01988****12",
        feeMinor: 0,
        balanceAfterMinor: 1000000,
        rawText: fixtureLine(BKASH_BROKEN_LINES[6]),
      },
      {
        // THE BUG: the statement shows -2,750.25, a payment out. Extracted as
        // money in, so the computed closing balance overshoots by 2 x 2,750.25.
        occurredAt: "2026-05-09T19:15:00+06:00",
        amountMinor: 275025,
        direction: "credit",
        currency: "BDT",
        refId: "BKT5Y6U7I8",
        counterparty: "Chaldal Online",
        description: "Payment",
        provider: "bkash",
        accountRef: "01988****12",
        feeMinor: 0,
        balanceAfterMinor: 724975,
        rawText: fixtureLine(BKASH_BROKEN_LINES[7]),
      },
      {
        occurredAt: "2026-05-18T12:03:00+06:00",
        amountMinor: 100000,
        direction: "debit",
        currency: "BDT",
        refId: "BKO9P0A1S2",
        counterparty: "01677889900",
        description: "Send Money",
        provider: "bkash",
        accountRef: "01988****12",
        feeMinor: 500,
        balanceAfterMinor: 624475,
        rawText: fixtureLine(BKASH_BROKEN_LINES[8]),
      },
    ],
  },
  // 600000 + 400000 + 275025 - 100000 - 500 = 1174525, declared 624475.
  expected: { status: "failed", deltaMinor: 550050 },
};

// ---------------------------------------------------------------------------
// 4. Ambiguous numeric dates. The model reads 03/04/2026 the American way; the
//    25/04/2026 row elsewhere in the document settles it as day-first, and the
//    pipeline is expected to correct the other rows accordingly.
// ---------------------------------------------------------------------------

const BANK_AMBIGUOUS_LINES: string[][] = [
  ["CITY BANK PLC"],
  ["Statement of Account"],
  ["Account Number: ****8890"],
  ["Period: 01/04/2026 to 30/04/2026"],
  ["Opening Balance: 20,000.00"],
  ["Date", "Description", "Debit", "Credit", "Balance"],
  ["03/04/2026", "UTILITY BILL DESCO APR", "1,200.00", "", "18,800.00"],
  ["09/04/2026", "CHEQUE DEPOSIT 442019", "", "7,500.00", "26,300.00"],
  ["25/04/2026", "CARD PAYMENT DARAZ BD", "2,300.00", "", "24,000.00"],
  ["Closing Balance: 24,000.00"],
];

export const BANK_AMBIGUOUS_DATES: StatementFixture = {
  id: "bank-ambiguous-dates",
  label: "City Bank statement whose dates the model reads month-first",
  match: ["CITY BANK PLC", "442019"],
  lines: BANK_AMBIGUOUS_LINES,
  columnX: [40, 110, 320, 400, 480],
  fontSize: 7,
  extraction: {
    provider: "bank",
    accountRef: "****8890",
    currency: "BDT",
    periodStart: "01/04/2026",
    periodEnd: "30/04/2026",
    openingBalanceMinor: 2000000,
    closingBalanceMinor: 2400000,
    rows: [
      {
        // Model said 4 March. rawText says 03/04/2026, which the document's own
        // 25/04/2026 row proves is 3 April.
        occurredAt: "2026-03-04T00:00:00+06:00",
        amountMinor: 120000,
        direction: "debit",
        currency: "BDT",
        refId: null,
        counterparty: "DESCO",
        description: "Utility bill",
        provider: "bank",
        accountRef: "****8890",
        feeMinor: 0,
        balanceAfterMinor: 1880000,
        rawText: fixtureLine(BANK_AMBIGUOUS_LINES[6]),
      },
      {
        // Model said 4 September; really 9 April.
        occurredAt: "2026-09-04T00:00:00+06:00",
        amountMinor: 750000,
        direction: "credit",
        currency: "BDT",
        refId: "442019",
        counterparty: "Cheque deposit",
        description: "Cheque deposit 442019",
        provider: "bank",
        accountRef: "****8890",
        feeMinor: 0,
        balanceAfterMinor: 2630000,
        rawText: fixtureLine(BANK_AMBIGUOUS_LINES[7]),
      },
      {
        occurredAt: "2026-04-25T00:00:00+06:00",
        amountMinor: 230000,
        direction: "debit",
        currency: "BDT",
        refId: null,
        counterparty: "Daraz BD",
        description: "Card payment",
        provider: "bank",
        accountRef: "****8890",
        feeMinor: 0,
        balanceAfterMinor: 2400000,
        rawText: fixtureLine(BANK_AMBIGUOUS_LINES[8]),
      },
    ],
  },
  expected: { status: "verified", deltaMinor: 0 },
};

// ---------------------------------------------------------------------------
// 5. An SMS alert. One transaction, no opening or closing balance, so there is
//    nothing to reconcile against: not_applicable, and the rows stay
//    provisional.
// ---------------------------------------------------------------------------

const SMS_ALERT_LINES: string[][] = [
  ["bKash Transaction Alert"],
  ["You have received Tk 1,200.00 from 01911223344."],
  ["Fee Tk 0.00. Balance Tk 4,450.00. TrxID CGZ1X9Y8W7 at 12/04/2026 14:05."],
];

export const SMS_ALERT: StatementFixture = {
  id: "sms-alert",
  label: "bKash SMS alert — no balances, nothing to verify",
  match: ["CGZ1X9Y8W7"],
  lines: SMS_ALERT_LINES,
  columnX: [40],
  fontSize: 9,
  extraction: {
    provider: "bkash",
    accountRef: null,
    currency: "BDT",
    periodStart: null,
    periodEnd: null,
    openingBalanceMinor: null,
    closingBalanceMinor: null,
    rows: [
      {
        occurredAt: "2026-04-12T14:05:00+06:00",
        amountMinor: 120000,
        direction: "credit",
        currency: "BDT",
        refId: "CGZ1X9Y8W7",
        counterparty: "01911223344",
        description: "Received money",
        provider: "bkash",
        accountRef: null,
        feeMinor: 0,
        balanceAfterMinor: 445000,
        rawText: `${fixtureLine(SMS_ALERT_LINES[1])} ${fixtureLine(SMS_ALERT_LINES[2])}`,
      },
    ],
  },
  expected: { status: "not_applicable", deltaMinor: 0 },
};

export const FIXTURES: StatementFixture[] = [
  BKASH_CLEAN,
  BANK_CLEAN,
  BKASH_BROKEN,
  BANK_AMBIGUOUS_DATES,
  SMS_ALERT,
];

export function fixtureById(id: string): StatementFixture {
  const found = FIXTURES.find((fixture) => fixture.id === id);
  if (!found) throw new Error(`No statement fixture with id "${id}"`);
  return found;
}
