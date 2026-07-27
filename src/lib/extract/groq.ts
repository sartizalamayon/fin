import Groq from "groq-sdk";

import {
  StatementExtractionSchema,
  type LlmProvider,
  type Provider,
  type StatementExtraction,
} from "@/lib/core/types";
import {
  InvalidApiKeyError,
  LlmRequestError,
  LlmResponseError,
  RateLimitError,
} from "./errors";
import { buildExtractionPrompt, buildRepairPrompt } from "./prompt";

/**
 * Groq-backed statement extraction.
 *
 * Bring-your-own-key: there is no server-side Groq credential. The key belongs
 * to the signed-in user, is decrypted from the vault for the duration of one
 * request, and is never logged or echoed back.
 *
 * The model is a transcriber here, not a reasoner — it copies figures out of a
 * table. That is why a small fast model is the right default: correctness is
 * enforced downstream by `reconcile()`, which proves the extracted rows sum to
 * the statement's own closing balance. A cleverer model would not remove the
 * need for that check, and this one does not weaken it.
 */

export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

/**
 * Characters of statement text per request. Roughly 4 chars/token, so ~24k
 * characters leaves comfortable room for the prompt and the JSON response
 * inside a 32k context while keeping each call fast.
 */
const DEFAULT_CHUNK_CHARS = 24_000;

export interface GroqLlmProviderOptions {
  model?: string;
  /** Max statement characters per request before splitting. */
  chunkChars?: number;
  /** Overrides the SDK client. Tests inject a stub; production leaves it unset. */
  client?: Pick<Groq, "chat">;
  /** Sampling temperature. Zero — transcription must not be creative. */
  temperature?: number;
}

export class GroqLlmProvider implements LlmProvider {
  readonly name = "groq";

  private readonly client: Pick<Groq, "chat">;
  private readonly model: string;
  private readonly chunkChars: number;
  private readonly temperature: number;

  constructor(apiKey: string, options: GroqLlmProviderOptions = {}) {
    if (!options.client && (!apiKey || apiKey.trim() === "")) {
      throw new InvalidApiKeyError();
    }

    this.client =
      options.client ?? new Groq({ apiKey, maxRetries: 2, timeout: 120_000 });
    this.model = options.model ?? process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
    this.chunkChars = options.chunkChars ?? DEFAULT_CHUNK_CHARS;
    this.temperature = options.temperature ?? 0;
  }

  async extractStatement(input: {
    text: string;
    hint?: { provider?: Provider; bankName?: string };
  }): Promise<StatementExtraction> {
    const chunks = splitStatement(input.text, this.chunkChars);

    const extractions: StatementExtraction[] = [];
    for (let index = 0; index < chunks.length; index++) {
      extractions.push(
        await this.extractChunk({
          text: chunks[index],
          hint: input.hint,
          chunk:
            chunks.length > 1
              ? { index: index + 1, total: chunks.length }
              : undefined,
        }),
      );
    }

    return mergeExtractions(extractions);
  }

  private async extractChunk(input: {
    text: string;
    hint?: { provider?: Provider; bankName?: string };
    chunk?: { index: number; total: number };
  }): Promise<StatementExtraction> {
    const prompt = buildExtractionPrompt(input);
    const raw = await this.complete(prompt.system, prompt.user);

    const first = parseAndValidate(raw);
    if (first.ok) return first.value;

    // One repair attempt, with the validation error handed back to the model.
    // Beyond that we stop: a model that cannot produce the shape twice is not
    // going to produce trustworthy figures on a third try.
    const repaired = await this.complete(
      prompt.system,
      buildRepairPrompt({ previousResponse: raw, issues: first.error }),
    );

    const second = parseAndValidate(repaired);
    if (second.ok) return second.value;

    throw new LlmResponseError(
      `The model did not return valid statement JSON after a retry: ${second.error}`,
    );
  }

  private async complete(system: string, user: string): Promise<string> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: this.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });

      const content = completion.choices?.[0]?.message?.content;
      if (!content || content.trim() === "") {
        throw new LlmResponseError("The model returned an empty response.");
      }
      return content;
    } catch (err) {
      throw translateGroqError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

type ParseResult =
  | { ok: true; value: StatementExtraction }
  | { ok: false; error: string };

function parseAndValidate(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    return { ok: false, error: `response was not valid JSON: ${describe(err)}` };
  }

  const parsed = StatementExtractionSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: issues };
  }

  return { ok: true, value: parsed.data };
}

/** Models occasionally wrap JSON in ```json fences despite json_object mode. */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split on line boundaries so no transaction row is ever cut in half. A row
 * severed across two requests would be dropped by one chunk and mangled by the
 * other — and the resulting gap would surface as a reconciliation failure with
 * a confusing cause.
 */
export function splitStatement(text: string, chunkChars: number): string[] {
  if (text.length <= chunkChars) return [text];

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;

  for (const line of lines) {
    // +1 for the newline we will rejoin with.
    if (size > 0 && size + line.length + 1 > chunkChars) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }

  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

/**
 * Rebuild one statement from its chunks.
 *
 * Balances are positional, not additive: the opening balance is whatever the
 * FIRST chunk saw and the closing balance is whatever the LAST chunk saw.
 * Summing them, or taking the first non-null of each, would silently corrupt
 * the very figures reconciliation depends on.
 */
export function mergeExtractions(
  extractions: readonly StatementExtraction[],
): StatementExtraction {
  if (extractions.length === 0) {
    throw new LlmResponseError("No extraction results to merge.");
  }
  if (extractions.length === 1) return extractions[0];

  const first = extractions[0];
  const last = extractions[extractions.length - 1];

  return {
    provider: first.provider,
    accountRef:
      extractions.find((e) => e.accountRef != null)?.accountRef ?? null,
    currency: first.currency,
    periodStart: first.periodStart,
    periodEnd: last.periodEnd ?? first.periodEnd,
    openingBalanceMinor: first.openingBalanceMinor,
    closingBalanceMinor: last.closingBalanceMinor,
    rows: extractions.flatMap((e) => e.rows),
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Turn SDK failures into errors the UI can act on. The distinction matters:
 * a bad key is something the user fixes in Settings, a rate limit is something
 * they wait out, and neither should read as "your statement is broken".
 */
function translateGroqError(err: unknown): Error {
  if (
    err instanceof InvalidApiKeyError ||
    err instanceof RateLimitError ||
    err instanceof LlmResponseError
  ) {
    return err;
  }

  const status = readStatus(err);

  if (status === 401 || status === 403) return new InvalidApiKeyError(err);
  if (status === 429) return new RateLimitError(readRetryAfter(err), err);

  return new LlmRequestError(status, describe(err), err);
}

function readStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** Groq returns `retry-after` in seconds on a 429; surface it to the user. */
function readRetryAfter(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const headers = (err as { headers?: unknown }).headers;
  if (typeof headers !== "object" || headers === null) return null;

  const raw =
    headers instanceof Headers
      ? headers.get("retry-after")
      : (headers as Record<string, unknown>)["retry-after"];

  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
