/**
 * Deterministic LLM provider for tests and local development.
 *
 * The whole point of the reconcile-everything design is that it can be tested
 * without a model in the loop. This provider matches the input text against
 * fixtures and returns their canned JSON through the same zod validation the
 * Groq provider uses — so the suite runs with no network, no API key, and no
 * per-run variance.
 */

import {
  StatementExtractionSchema,
  type LlmProvider,
  type Provider,
  type StatementExtraction,
} from "@/lib/core/types";

import { NoFixtureError } from "./errors";
import {
  FIXTURES,
  type StatementFixture,
} from "./__fixtures__/statements";

export { NoFixtureError } from "./errors";
export {
  FIXTURES,
  fixtureById,
  fixtureText,
  type StatementFixture,
} from "./__fixtures__/statements";

export interface MockLlmProviderOptions {
  /** Replaces the built-in fixture set. Useful for one-off scenarios. */
  fixtures?: readonly StatementFixture[];
  /**
   * What to do when nothing matches. `throw` (default) keeps tests honest —
   * a silent empty extraction would reconcile as `failed` and look like a bug
   * in the reconciler rather than a missing fixture.
   */
  onMiss?: "throw" | "empty";
  /** Fails every call with this error. For exercising error paths. */
  failWith?: Error;
}

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";

  /** Every call this provider has served, in order. Handy for assertions. */
  readonly calls: { text: string; hint?: { provider?: Provider; bankName?: string } }[] =
    [];

  private readonly fixtures: readonly StatementFixture[];
  private readonly onMiss: "throw" | "empty";
  private readonly failWith?: Error;

  constructor(options: MockLlmProviderOptions = {}) {
    this.fixtures = options.fixtures ?? FIXTURES;
    this.onMiss = options.onMiss ?? "throw";
    this.failWith = options.failWith;
  }

  async extractStatement(input: {
    text: string;
    hint?: { provider?: Provider; bankName?: string };
  }): Promise<StatementExtraction> {
    this.calls.push(input);
    if (this.failWith) throw this.failWith;

    const fixture = this.match(input.text, input.hint?.provider);

    if (!fixture) {
      if (this.onMiss === "empty") return emptyExtraction(input.hint?.provider);
      throw new NoFixtureError(collapse(input.text).slice(0, 120));
    }

    // Parse rather than cast: the fixtures are raw model-shaped JSON, and this
    // is the same gate the production provider puts its responses through.
    return StatementExtractionSchema.parse(fixture.extraction);
  }

  /** The fixture this text would resolve to, or null. Exposed for tests. */
  match(text: string, provider?: Provider): StatementFixture | null {
    const haystack = collapse(text);

    const candidates = this.fixtures.filter((fixture) =>
      fixture.match.every((needle) => haystack.includes(collapse(needle))),
    );

    if (candidates.length === 0) return null;
    if (candidates.length === 1 || !provider) return candidates[0];

    // More than one fixture claims the text: let the caller's provider hint
    // break the tie, falling back to document order.
    return (
      candidates.find(
        (fixture) =>
          (fixture.extraction as { provider?: string }).provider === provider,
      ) ?? candidates[0]
    );
  }
}

function emptyExtraction(provider?: Provider): StatementExtraction {
  return StatementExtractionSchema.parse({
    provider: provider ?? "manual",
    accountRef: null,
    currency: "BDT",
    periodStart: null,
    periodEnd: null,
    openingBalanceMinor: null,
    closingBalanceMinor: null,
    rows: [],
  });
}

/**
 * Whitespace-insensitive comparison. Column gaps depend on font metrics, so a
 * fixture must match whether it came from `fixtureText` or from a real PDF.
 */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
