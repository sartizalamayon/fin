# fin.

One honest ledger across every account you use — banks and mobile financial
services (bKash, Nagad, Rocket).

Bangladeshi statements arrive as password-protected PDFs. A statement is
unlocked in memory, every transaction extracted with an LLM, and the result
**proven correct against the statement's own closing balance** before any
figure reaches your dashboard.

## Why the balance check matters

An LLM reading a statement doesn't fail loudly — it fails *plausibly*. It can
return `৳5,400` where the page said `৳5,600` and nothing looks wrong. On money,
that is unacceptable.

Statements carry an opening and a closing balance, which gives us arithmetic
proof over a probabilistic extractor:

```
opening + Σ credits − Σ debits − Σ fees  ==  closing
```

A single wrong digit anywhere breaks the sum. If it balances, every row is
right. If it doesn't, the import is held back and shown for review rather than
silently trusted. Sources with no balance to check against (email alerts, SMS)
are marked `not_applicable` and treated as provisional — statement data always
wins on conflict.

## Design decisions worth knowing

- **Money is integer minor units (poisha) everywhere.** Never floats.
  `parseFloat("1234.56") * 100` is `123455.99999999999`, and across thousands of
  rows that drift produces reconciliation failures that look like extraction
  bugs.
- **Dates are never assumed.** `03/04/2026` is March 4th or April 3rd depending
  on the issuer. The parser scans a whole document for a row whose day exceeds
  12, which settles the format for every other row in that file.
- **The uploaded PDF is never stored.** It is processed in memory and
  discarded; only extracted rows and their verbatim source text are kept. A
  breach exposes transaction rows, not complete signed bank documents.
- **Statement passwords are never stored.** Used once, then dropped.
- **Own-account transfers net to zero.** Moving money from a bank to bKash is
  one movement, not income plus an expense. Counting both inflates income *and*
  spending at the same time.
- **Isolation lives in the database.** Postgres Row Level Security, not a
  `WHERE user_id = ?` you might forget one day.

## Bring your own Groq key

There is no server-side LLM key. Each user creates a free key at
[groq.com](https://groq.com) and pastes it in during onboarding. It is
encrypted at rest with AES-256-GCM and never returned to the browser.

## Sign-in

Three ways in, no password anywhere: **Continue with Google**, **Continue with
Outlook**, or an emailed link. A password we store is a password we can leak,
and this app holds financial records.

The email link works out of the box. The two OAuth buttons need client
credentials registered with each provider — until then they render but report
that the provider is not switched on, and point at the email link.

### Enabling Google

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client
   ID** → *Web application*.
2. Authorised redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. Copy the client ID and secret into Supabase → **Authentication → Providers →
   Google**, and enable it.

### Enabling Outlook

1. Azure Portal → **Microsoft Entra ID → App registrations → New registration**.
2. Redirect URI (type *Web*):
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. **Certificates & secrets → New client secret.**
4. Put the Application (client) ID and the secret value into Supabase →
   **Authentication → Providers → Azure**, and enable it.

Supabase calls the Microsoft provider `azure`; the button says Outlook because
that is the word people recognise.

### Redirect configuration

Supabase falls back to the project's **Site URL** whenever a redirect target is
not on its allow list — and that fallback *drops the path*, so a sign-in link
arrives at `/?code=...` instead of `/auth/callback?code=...` and the code is
never exchanged. The login simply does nothing, with no error. Keep both set:

- **Site URL** — the deployed origin
- **Redirect URLs** — `<origin>/auth/callback` and `http://localhost:3000/auth/callback`

`NEXT_PUBLIC_AUTH_PROVIDERS` controls which buttons appear (`google,azure` by
default; set it empty to show none).

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm db:migrate
pnpm dev
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm test` | Unit + component tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright, mobile + desktop) |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm db:migrate` | Apply database migrations |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui ·
Postgres/Supabase · Groq · Recharts · Vitest · Playwright
