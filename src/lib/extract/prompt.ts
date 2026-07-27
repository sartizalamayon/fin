/**
 * The extraction prompt.
 *
 * Reconciliation (see reconcile.ts) is what makes an LLM safe on money, but it
 * can only prove arithmetic it is given. Every rule here exists because
 * breaking it makes the arithmetic wrong in a way that is hard to attribute:
 * a float amount drifts, a balance line counted as a transaction double-counts,
 * a missing opening balance means nothing can be verified at all.
 */

import type { Provider } from "@/lib/core/types";

export interface PromptInput {
  /** Statement text, already line-grouped by pdf.ts. */
  text: string;
  hint?: { provider?: Provider; bankName?: string };
  /** Set when the statement was split; lets the model know it sees a slice. */
  chunk?: { index: number; total: number };
}

export interface ChatPrompt {
  system: string;
  user: string;
}

/**
 * The JSON contract, written as an annotated shape rather than JSON Schema —
 * small models follow a commented example far more reliably.
 */
const RESPONSE_SHAPE = `{
  "provider": "bkash" | "nagad" | "rocket" | "upay" | "bank" | "card" | "manual",
  "accountRef": string | null,      // masked account/wallet id exactly as printed, e.g. "****4471"
  "currency": "BDT" | "USD" | "EUR" | "GBP" | "INR",
  "periodStart": string | null,     // statement period start, verbatim from the document
  "periodEnd": string | null,       // statement period end, verbatim from the document
  "openingBalanceMinor": integer | null,
  "closingBalanceMinor": integer | null,
  "rows": [
    {
      "occurredAt": string,         // ISO 8601, e.g. "2026-03-05T18:41:00+06:00"
      "amountMinor": integer,       // ALWAYS POSITIVE
      "direction": "credit" | "debit",
      "currency": "BDT" | "USD" | "EUR" | "GBP" | "INR",
      "refId": string | null,       // provider transaction id (bKash TrxID, bank reference)
      "counterparty": string | null,// the other party: merchant, agent, sender, receiver
      "description": string,        // short human description
      "provider": "bkash" | "nagad" | "rocket" | "upay" | "bank" | "card" | "manual",
      "accountRef": string | null,
      "feeMinor": integer,          // 0 when no fee
      "balanceAfterMinor": integer | null,
      "rawText": string             // the source line, verbatim
    }
  ]
}`;

export const EXTRACTION_SYSTEM_PROMPT = `You extract transactions from Bangladeshi bank and mobile financial service (bKash, Nagad, Rocket, Upay) statements.

You reply with a single JSON object and nothing else. No prose, no markdown, no code fences.

The JSON must match this shape exactly:
${RESPONSE_SHAPE}

RULES — every one of these is checked by arithmetic after you answer.

1. MONEY IS INTEGER MINOR UNITS (poisha). Multiply the printed taka figure by 100
   and emit an integer. NEVER emit a float or a string.
     1,234.56  ->  123456
     500.00    ->  50000
     845.50    ->  84550
     1,581     ->  158100
   A value like 1234.56 or "1,234.56" is wrong. Only 123456 is correct.

2. AMOUNTS ARE ALWAYS POSITIVE. Direction carries the sign:
     "credit" = money INTO the account (deposit, cash in, salary, received, refund)
     "debit"  = money OUT of the account (payment, cash out, send money, purchase, charge)
   A minus sign, a "Dr" marker, or a figure in the Debit column all mean "debit"
   with a positive amountMinor. Never emit a negative amountMinor.

3. EVERY TRANSACTION ROW, IN DOCUMENT ORDER. Do not summarise, sample, dedupe,
   reorder or skip rows. If the statement lists 63 transactions, "rows" has 63
   entries in the order they are printed.

4. BALANCE LINES ARE NOT TRANSACTIONS. Skip:
     - "Opening Balance" / "Previous Balance" / "Balance B/F" lines
     - "Closing Balance" / "Balance C/F" / "Total" / subtotal lines
     - repeated column headers and page headers/footers
     - lines matching "--- page N ---" (these are page markers we inserted)
   Those figures belong in openingBalanceMinor / closingBalanceMinor, never in "rows".

5. OPENING AND CLOSING BALANCE ARE REQUIRED WHEN PRINTED. Read them from the
   statement header, summary box, or footer and put them in openingBalanceMinor
   and closingBalanceMinor. They are how the extraction gets verified — without
   them nothing can be proven. Use null ONLY when the document genuinely states
   no balance (an SMS or email alert). If the statement shows a running Balance
   column but no explicit summary, the opening balance is the balance BEFORE the
   first row and the closing balance is the balance after the LAST row.

6. TRANSACTION IDS GO IN refId. bKash calls this "TrxID", Nagad "TxnID", banks
   print a reference or cheque number. Copy it exactly, uppercase as printed.
   Use null when the row has none.

7. FEES GO IN feeMinor, NOT IN A ROW OF THEIR OWN. bKash charges a fee on send
   money and cash out; it is printed in its own column on the same line, and it
   is not a separate transaction. Put it in that row's feeMinor and leave
   amountMinor as the transaction amount alone.
     Send Money 1,500.00, fee 5.00  ->  amountMinor 150000, feeMinor 500
   A bank "Service Charge" printed as its own dated row IS its own transaction:
   emit it as a debit row with feeMinor 0.

8. balanceAfterMinor is the running balance printed on that row, as an integer
   minor-unit value, or null when the statement prints no running balance.

9. rawText IS THE SOURCE LINE, VERBATIM. Copy the whole line for that row from
   the input, unchanged, including its date exactly as printed. Do not reformat
   it, do not normalise the date, do not translate it.

10. DATES: put your best ISO 8601 reading in occurredAt, and keep the printed
    date untouched inside rawText. Do not try to resolve ambiguous formats like
    03/04/2026 — the printed form in rawText is what settles it downstream.

11. If a value is genuinely absent, use null. Do not invent, estimate, or
    round anything. An honest null is always better than a plausible guess.`;

export function buildExtractionPrompt(input: PromptInput): ChatPrompt {
  const preamble: string[] = [];

  if (input.hint?.provider) {
    preamble.push(
      `The user says this statement is from: ${input.hint.provider}. Use "${input.hint.provider}" as the provider unless the document clearly contradicts it.`,
    );
  }
  if (input.hint?.bankName) {
    preamble.push(`Institution: ${input.hint.bankName}.`);
  }
  if (input.chunk && input.chunk.total > 1) {
    preamble.push(
      `This is part ${input.chunk.index + 1} of ${input.chunk.total} of one statement. ` +
        `Extract only the rows present in this part. ` +
        (input.chunk.index === 0
          ? "The opening balance is in this part; set closingBalanceMinor to null unless the closing summary is also here."
          : input.chunk.index === input.chunk.total - 1
            ? "The closing balance is in this part; set openingBalanceMinor to null unless the opening summary is also here."
            : "Set openingBalanceMinor and closingBalanceMinor to null — neither summary is in this part."),
    );
  }

  const header = preamble.length > 0 ? `${preamble.join("\n")}\n\n` : "";

  return {
    system: EXTRACTION_SYSTEM_PROMPT,
    user: `${header}Extract every transaction from this statement text and reply with the JSON object only.

--- BEGIN STATEMENT TEXT ---
${input.text}
--- END STATEMENT TEXT ---`,
  };
}

/**
 * Second attempt after schema validation failed.
 *
 * The model gets its own output back plus the exact validator complaints — far
 * more effective than restating the rules, because the failure is usually one
 * field (a float amount, a negative value) rather than a misunderstanding.
 */
export function buildRepairPrompt(input: {
  previousResponse: string;
  issues: string;
}): string {
  return `Your previous response did not match the required JSON shape.

Validation errors:
${input.issues}

Your previous response was:
${input.previousResponse}

Fix ONLY what the validation errors name and reply with the corrected JSON object, nothing else.
Reminders: amountMinor and feeMinor are POSITIVE INTEGERS in poisha (multiply taka by 100 — 845.50 becomes 84550, never 845.5); direction is "credit" or "debit"; occurredAt is an ISO 8601 string; rawText is the verbatim source line.`;
}
