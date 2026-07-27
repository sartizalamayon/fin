/**
 * Postgres connection pool (postgres.js).
 *
 * Server-only. The same code path serves local Postgres and Supabase — only
 * DATABASE_URL differs.
 *
 * On isolation: this connection uses the application/owner role, which is not
 * subject to RLS. That is why every query in queries.ts filters on user_id
 * explicitly. RLS (see 0001_init.sql) is the backstop that protects the
 * PostgREST/supabase-js path and any future direct client access — belt and
 * braces, not one or the other. Use withUser() when you want a query to be
 * genuinely RLS-enforced.
 */

import postgres from "postgres";

const DEFAULT_DATABASE_URL = "postgres://localhost:5432/money_management";

/**
 * Parse int8 as a JS number rather than the default string.
 *
 * Every money column is BIGINT minor units. Poisha values stay far inside
 * Number.MAX_SAFE_INTEGER (9e15 poisha is ৳90 trillion), and the domain types
 * in core/types.ts declare `number` — but we assert the bound rather than
 * assume it, because a silently rounded balance is exactly the class of bug
 * the integer-minor-units rule exists to prevent.
 */
const bigintAsNumber: postgres.PostgresType<number> = {
  to: 20,
  from: [20],
  serialize: (value: number) => value.toString(),
  parse: (raw: string) => {
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `bigint ${raw} exceeds Number.MAX_SAFE_INTEGER and would lose precision`,
      );
    }
    return value;
  },
};

export type AppSql = postgres.Sql<{ bigint: number }>;
export type AppTransactionSql = postgres.TransactionSql<{ bigint: number }>;

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

function createSql(): AppSql {
  const url = getDatabaseUrl();

  return postgres(url, {
    // Supabase requires TLS; a local socket does not offer it.
    ssl: url.includes("supabase.") ? "require" : false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 30,
    connect_timeout: 10,
    types: { bigint: bigintAsNumber },
    // Statements are prepared per connection; PgBouncer in transaction mode
    // (Supabase's pooler, port 6543) cannot support that.
    prepare: !url.includes(":6543"),
    onnotice: () => {},
    connection: { application_name: "money-management" },
  });
}

/**
 * Cached on globalThis so Next.js dev HMR does not open a new pool on every
 * edit until Postgres runs out of connections.
 */
const globalForDb = globalThis as unknown as { __moneyManagementSql?: AppSql };

export function getSql(): AppSql {
  globalForDb.__moneyManagementSql ??= createSql();
  return globalForDb.__moneyManagementSql;
}

/**
 * Run a callback inside a transaction with `app.user_id` set, so the RLS
 * policies from 0001_init.sql actually apply (auth.uid() reads that GUC on
 * local Postgres; on Supabase the JWT claim takes precedence).
 *
 * Useful for verifying isolation and for any code path that runs as a
 * restricted role. The GUC is set local to the transaction, so it cannot leak
 * to the next borrower of the pooled connection.
 */
export async function withUser<T>(
  userId: string,
  fn: (sql: AppTransactionSql) => Promise<T>,
): Promise<T> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Close the pool. For scripts and test teardown; app code should not call it. */
export async function closeSql(): Promise<void> {
  const sql = globalForDb.__moneyManagementSql;
  if (!sql) return;
  globalForDb.__moneyManagementSql = undefined;
  await sql.end({ timeout: 5 });
}
