/**
 * Typed failures for the extraction pipeline.
 *
 * Every one of these is something the *user* can act on — supply a password,
 * fix an API key, wait out a rate limit, re-upload a scanned page. The UI
 * switches on `code`; `userMessage` is written to be shown verbatim. Anything
 * that is genuinely a bug stays a plain `Error` so it surfaces as a crash
 * rather than as friendly, dismissible copy.
 */

export const EXTRACTION_ERROR_CODES = [
  "password_required",
  "wrong_password",
  "pdf_parse_failed",
  "no_text_layer",
  "invalid_api_key",
  "rate_limited",
  "llm_response_invalid",
  "llm_request_failed",
  "no_fixture",
] as const;
export type ExtractionErrorCode = (typeof EXTRACTION_ERROR_CODES)[number];

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  /** Safe to render straight into the UI. Never contains statement contents. */
  readonly userMessage: string;
  /** True when simply trying again could plausibly work. */
  readonly retryable: boolean;

  constructor(
    code: ExtractionErrorCode,
    message: string,
    options: { userMessage?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.userMessage = options.userMessage ?? message;
    this.retryable = options.retryable ?? false;
  }
}

/** The PDF is encrypted and no password was supplied. */
export class PasswordRequiredError extends ExtractionError {
  constructor(cause?: unknown) {
    super("password_required", "PDF is password protected and no password was given", {
      userMessage:
        "This statement is password protected. Bangladeshi banks usually use your NID, " +
        "date of birth, or the last digits of your account or card number.",
      cause,
    });
  }
}

/** The PDF is encrypted and the supplied password did not open it. */
export class WrongPasswordError extends ExtractionError {
  constructor(cause?: unknown) {
    super("wrong_password", "PDF password is incorrect", {
      userMessage:
        "That password did not unlock the statement. Check the email the bank sent — " +
        "the format is usually stated there.",
      cause,
    });
  }
}

/** The bytes are not a PDF we can read at all. */
export class PdfParseError extends ExtractionError {
  constructor(detail: string, cause?: unknown) {
    super("pdf_parse_failed", `Could not read PDF: ${detail}`, {
      userMessage:
        "This file could not be read as a PDF. Try re-downloading it from your bank.",
      cause,
    });
  }
}

/** The PDF opened but carries no text layer — almost certainly a scan. */
export class NoTextLayerError extends ExtractionError {
  readonly pageCount: number;

  constructor(pageCount: number) {
    super("no_text_layer", `PDF has no text layer across ${pageCount} page(s)`, {
      userMessage:
        "This looks like a scanned or photographed statement — there is no text in the " +
        "file to read. Ask your bank for the original e-statement PDF.",
    });
    this.pageCount = pageCount;
  }
}

/** Groq rejected the key (HTTP 401). Bring-your-own-key, so the user owns this. */
export class InvalidApiKeyError extends ExtractionError {
  constructor(cause?: unknown) {
    super("invalid_api_key", "Groq rejected the API key (401)", {
      userMessage:
        "Your Groq API key was rejected. Check it in Settings, or create a new one at " +
        "console.groq.com.",
      cause,
    });
  }
}

/** Groq rate limited us (HTTP 429). */
export class RateLimitError extends ExtractionError {
  /** Seconds to wait, when the response said so. */
  readonly retryAfterSeconds: number | null;

  constructor(retryAfterSeconds: number | null, cause?: unknown) {
    super("rate_limited", "Groq rate limit hit (429)", {
      userMessage: retryAfterSeconds
        ? `Groq is rate limiting your key. Try again in about ${Math.ceil(retryAfterSeconds)} seconds.`
        : "Groq is rate limiting your key. Wait a moment and try again.",
      retryable: true,
      cause,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The model answered, but not with something matching StatementExtraction. */
export class LlmResponseError extends ExtractionError {
  /** Formatted zod issues, or the JSON parse failure. Useful in bug reports. */
  readonly detail: string;

  constructor(detail: string, cause?: unknown) {
    super("llm_response_invalid", `Model returned an unusable response: ${detail}`, {
      userMessage:
        "The model returned a malformed statement. This usually clears up on a retry; " +
        "if it keeps happening, try a different model.",
      retryable: true,
      cause,
    });
    this.detail = detail;
  }
}

/** Any other non-2xx from Groq. */
export class LlmRequestError extends ExtractionError {
  readonly status: number | null;

  constructor(status: number | null, detail: string, cause?: unknown) {
    super("llm_request_failed", `Groq request failed${status ? ` (${status})` : ""}: ${detail}`, {
      userMessage: "Could not reach Groq. Check your connection and try again.",
      retryable: true,
      cause,
    });
    this.status = status;
  }
}

/** The mock provider was handed text no fixture claims. Tests only. */
export class NoFixtureError extends ExtractionError {
  constructor(preview: string) {
    super("no_fixture", `No mock fixture matches this text. First 120 chars: ${preview}`, {
      userMessage: "No test fixture matches this input.",
    });
  }
}

export function isExtractionError(err: unknown): err is ExtractionError {
  return err instanceof ExtractionError;
}
