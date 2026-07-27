import type { Provider } from "@/lib/core/types";

/**
 * Display metadata and, crucially, the password hint per provider.
 *
 * The hint is the difference between a user unlocking their statement and
 * giving up: nobody remembers setting a password on a file they never
 * password-protected, because the issuer chose it for them.
 */
export interface ProviderMeta {
  id: Provider;
  label: string;
  /** Shown under the password field. Must name the actual secret to type. */
  passwordHint: string;
  /** Mobile wallets share the mobile-number convention. */
  kind: "wallet" | "bank" | "other";
}

export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  bkash: {
    id: "bkash",
    label: "bKash",
    passwordHint:
      "Usually your 11-digit mobile number — the number the bKash account is registered to.",
    kind: "wallet",
  },
  nagad: {
    id: "nagad",
    label: "Nagad",
    passwordHint:
      "Usually your 11-digit mobile number — the number the Nagad account is registered to.",
    kind: "wallet",
  },
  rocket: {
    id: "rocket",
    label: "Rocket",
    passwordHint:
      "Usually your 11-digit mobile number — the number the Rocket account is registered to.",
    kind: "wallet",
  },
  upay: {
    id: "upay",
    label: "Upay",
    passwordHint:
      "Usually your 11-digit mobile number — the number the Upay account is registered to.",
    kind: "wallet",
  },
  bank: {
    id: "bank",
    label: "Bank",
    passwordHint:
      "Usually your customer ID, or your date of birth as DDMMYYYY (e.g. 04091998).",
    kind: "bank",
  },
  card: {
    id: "card",
    label: "Credit card",
    passwordHint:
      "Usually your customer ID, or your date of birth as DDMMYYYY (e.g. 04091998).",
    kind: "bank",
  },
  manual: {
    id: "manual",
    label: "Other",
    passwordHint:
      "Usually your 11-digit mobile number for a wallet, or your customer ID / date of birth as DDMMYYYY for a bank.",
    kind: "other",
  },
};

/** Providers a person can actually upload a statement for, in tap order. */
export const UPLOADABLE_PROVIDERS: Provider[] = [
  "bkash",
  "nagad",
  "rocket",
  "bank",
  "card",
];

export function providerLabel(provider: Provider | null): string {
  return provider ? PROVIDER_META[provider].label : "your provider";
}

/** Falls back to the both-conventions hint when the provider is unknown. */
export function passwordHintFor(provider: Provider | null): string {
  return PROVIDER_META[provider ?? "manual"].passwordHint;
}
