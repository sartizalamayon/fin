import { NextResponse } from "next/server";

import { encryptSecret, isVaultConfigured, maskSecret } from "@/lib/crypto/vault";
import {
  clearGroqApiKey,
  ensureProfile,
  getUserSettings,
  upsertUserSettings,
} from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * The user's Groq API key.
 *
 * The plaintext key crosses this boundary exactly once, on POST, and is
 * immediately encrypted. No handler in this file ever returns it — GET answers
 * with a mask and a boolean, which is all any screen needs to render.
 */

export const runtime = "nodejs";

/**
 * Groq issues keys prefixed `gsk_`. Catches paste errors before storage.
 * Kept identical to the client-side check in components/onboarding/groq-key.ts
 * — a stricter pattern here would reject keys the UI told the user were fine.
 */
const GROQ_KEY_PATTERN = /^gsk_[A-Za-z0-9_-]{16,}$/;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const settings = await getUserSettings(user.id);

  return NextResponse.json({
    configured: Boolean(settings?.groqKeyMasked),
    masked: settings?.groqKeyMasked ?? null,
    setAt: settings?.groqKeySetAt ?? null,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isVaultConfigured()) {
    return NextResponse.json(
      {
        error: "vault_unconfigured",
        message:
          "This deployment cannot store secrets yet — APP_ENCRYPTION_KEY is missing.",
      },
      { status: 500 },
    );
  }

  let apiKey: unknown;
  try {
    ({ apiKey } = await request.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (typeof apiKey !== "string" || !GROQ_KEY_PATTERN.test(apiKey.trim())) {
    return NextResponse.json(
      {
        error: "invalid_key",
        message:
          "That does not look like a Groq API key. Keys start with \"gsk_\" — copy it again from the API Keys page at groq.com.",
      },
      { status: 400 },
    );
  }

  const trimmed = apiKey.trim();

  await ensureProfile(user.id, user.email);
  await upsertUserSettings(user.id, {
    groqApiKeyEncrypted: encryptSecret(trimmed),
    groqKeyMasked: maskSecret(trimmed),
    groqKeySetAt: new Date(),
  });

  return NextResponse.json({ configured: true, masked: maskSecret(trimmed) });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await clearGroqApiKey(user.id);
  return NextResponse.json({ configured: false, masked: null });
}
