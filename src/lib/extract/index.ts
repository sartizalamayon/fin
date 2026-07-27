import {
  detectDateOrder,
  parseStatementDate,
  type DateOrder,
} from "@/lib/core/dates";
import type {
  ExtractedRow,
  LlmProvider,
  Provider,
  ReconcileResult,
  StatementExtraction,
} from "@/lib/core/types";
import { extractTextOrThrow, type PdfText } from "./pdf";
import { reconcile, findLikelyCulprits, type Culprit } from "./reconcile";

export * from "./errors";
export { extractText, extractTextOrThrow } from "./pdf";
export { reconcile, findLikelyCulprits } from "./reconcile";
export { GroqLlmProvider, DEFAULT_GROQ_MODEL } from "./groq";
export { MockLlmProvider } from "./mock";

export interface ExtractStatementInput {
  bytes: Uint8Array;
  /** Omitted on the first attempt; supplied after a PasswordRequiredError. */
  password?: string;
  llm: LlmProvider;
  hint?: { provider?: Provider; bankName?: string };
}

export interface ExtractStatementResult {
  extraction: StatementExtraction;
  reconcile: ReconcileResult;
  culprits: Culprit[];
  text: PdfText;
  /** How dates in this document were read, and whether evidence settled it. */
  dateOrder: { order: DateOrder; confident: boolean; evidence: string | null };
}

/**
 * Full statement pipeline: decrypt → text → model → date normalisation → proof.
 *
 * The order matters. Dates are re-derived from the source text BEFORE
 * reconciliation, because a row filed under the wrong month is still a
 * balance-correct row — reconciliation would happily pass a statement whose
 * every date is eleven months off. Arithmetic proves the amounts; only the
 * document's own date evidence can prove the dates.
 */
export async function extractStatement(
  input: ExtractStatementInput,
): Promise<ExtractStatementResult> {
  const text = await extractTextOrThrow(input.bytes, input.password);

  const raw = await input.llm.extractStatement({
    text: text.text,
    hint: input.hint,
  });

  const dateOrder = inferDateOrder(raw);
  const extraction: StatementExtraction = {
    ...raw,
    rows: raw.rows.map((row) => normaliseRowDate(row, dateOrder.order)),
  };

  const result = reconcile(extraction);
  const culprits =
    result.status === "failed"
      ? findLikelyCulprits(extraction, result.deltaMinor)
      : [];

  return { extraction, reconcile: result, culprits, text, dateOrder };
}

/**
 * Settle DD/MM vs MM/DD for the whole document from the rows' own source text.
 *
 * The model is asked for ISO dates, but it has to *decide* what `03/04/2026`
 * meant to do that, and it has no more information than we do — less, since it
 * sees one chunk at a time while we see every row. So we make the call
 * ourselves, from all the evidence at once.
 */
function inferDateOrder(extraction: StatementExtraction) {
  const samples: string[] = [];
  for (const row of extraction.rows) {
    if (row.rawText) samples.push(row.rawText);
  }
  if (extraction.periodStart) samples.push(extraction.periodStart);
  if (extraction.periodEnd) samples.push(extraction.periodEnd);

  return detectDateOrder(samples);
}

/**
 * Re-derive a row's timestamp from its verbatim source line.
 *
 * Falls back to the model's own value when the source line carries no parsable
 * date — some statements put the date in a column the row text does not repeat.
 */
function normaliseRowDate(row: ExtractedRow, order: DateOrder): ExtractedRow {
  if (!row.rawText) return row;

  const fromSource = parseStatementDate(row.rawText, order);
  if (!fromSource) return row;

  return { ...row, occurredAt: fromSource };
}
