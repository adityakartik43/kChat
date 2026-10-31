/**
 * Purge rows created by the E2E suites.
 *
 * Every test run registers fresh accounts, so a shared database accumulates
 * throwaway users, conversations, messages and calls. This removes them in one
 * shot rather than leaving them to pile up.
 *
 * Safety model
 * ------------
 * It only ever deletes users whose email is at `@example.com` — the domain the
 * suites use, and a reserved one per RFC 2606, so it can never match a real
 * signup. Accounts with any other domain are counted and reported, and left
 * alone. There is no "delete everything" mode, on purpose: the database is a
 * shared Supabase project and the only truly safe automated delete is one
 * scoped to a domain the app itself owns.
 *
 * Every foreign key to `users` is `onDelete: Cascade` (see schema.prisma), so
 * the dependent rows go with the user. Conversations do not: they reference
 * `users` only through their participants, and `createdById` is `SetNull`, so
 * they survive as empty shells and are swept in a second pass.
 *
 * Usage
 * -----
 *   node test/e2e/cleanup.mjs            # dry run, prints what would go
 *   node test/e2e/cleanup.mjs --yes      # actually delete
 *
 * Reads DATABASE_URL from backend/.env.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const APPLY = process.argv.includes('--yes');
const TEST_DOMAIN = '@example.com';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..', '..');

function loadEnv() {
  const raw = readFileSync(join(backendRoot, '.env'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '');
    env[key] = value;
  }
  return env;
}

// Every one of these references `users` with onDelete: Cascade, so counting
// them first is only for the report — the DELETE does the work. Column names
// are camelCase and case-sensitive, so they have to be double-quoted to
// survive Postgres' folding to lower case.
//
// `connections` and `calls` each hold two references to `users`, so a row with
// test users on both sides matches both entries. They are grouped by table and
// counted once per row, because a report that claims to have deleted 8 calls
// when it deleted 4 is worse than no report.
const CASCADE_CHILDREN = {
  auth_sessions: ['"userId"'],
  connections: ['"requesterId"', '"addresseeId"'],
  conversation_participants: ['"userId"'],
  messages: ['"senderId"'],
  message_reads: ['"userId"'],
  calls: ['"callerId"', '"calleeId"'],
};

async function main() {
  const url = loadEnv().DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set in backend/.env');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  // Pin search_path the same way PrismaService does, so unqualified names
  // resolve to `chat` rather than to whatever role default applies.
  await client.query(`SET search_path TO chat, public`);

  const keep = await client.query(
    `SELECT email FROM chat.users WHERE email NOT LIKE $1 ORDER BY email`,
    [`%${TEST_DOMAIN}`],
  );

  console.log(`\n\x1b[1mTest accounts (${TEST_DOMAIN}):\x1b[0m`);
  // Scoped to the test accounts, not whole-table totals. Reporting totals under
  // this heading would count real signups as test data — and this block sits
  // directly above the list of accounts being spared, so the two would read as
  // contradicting each other.
  const before = await client.query(
    `
    WITH t AS (SELECT id FROM chat.users WHERE email LIKE $1)
    SELECT
      (SELECT count(*) FROM chat.users WHERE email LIKE $1)          AS users,
      (SELECT count(*) FROM chat.conversations c
         WHERE EXISTS (SELECT 1 FROM chat.conversation_participants p
                        WHERE p."conversationId" = c.id AND p."userId" IN (SELECT id FROM t))
      )                                                                AS conversations,
      (SELECT count(*) FROM chat.messages WHERE "senderId" IN (SELECT id FROM t))
                                                                    AS messages,
      (SELECT count(*) FROM chat.calls
         WHERE "callerId" IN (SELECT id FROM t) OR "calleeId" IN (SELECT id FROM t))
                                                                    AS calls,
      (SELECT count(*) FROM chat.connections
         WHERE "requesterId" IN (SELECT id FROM t) OR "addresseeId" IN (SELECT id FROM t))
                                                                    AS connections,
      (SELECT count(*) FROM chat.auth_sessions WHERE "userId" IN (SELECT id FROM t))
                                                                    AS sessions
  `,
    [`%${TEST_DOMAIN}`],
  );
  const b = before.rows[0];
  console.log(
    `  users ${b.users}, conversations ${b.conversations}, messages ${b.messages}, ` +
      `calls ${b.calls}, connections ${b.connections}, sessions ${b.sessions}\n`,
  );

  if (keep.rowCount > 0) {
    console.log(
      `\x1b[33mWill NOT touch ${keep.rowCount} non-test account(s):\x1b[0m`,
    );
    for (const row of keep.rows) console.log(`  - ${row.email}`);
    console.log();
  }

  if (!APPLY) {
    console.log('\x1b[33mDry run.\x1b[0m Re-run with --yes to delete.');
    await client.end();
    return;
  }

  await client.query('BEGIN');

  // Resolve the targets first, then count their dependent rows while the
  // transaction still holds them. The report then reflects what this run
  // actually removed rather than what happened to be in the table.
  const target = await client.query(
    `SELECT id FROM chat.users WHERE email LIKE $1`,
    [`%${TEST_DOMAIN}`],
  );
  const ids = target.rows.map((r) => r.id);

  const removed = { users: ids.length };
  if (ids.length > 0) {
    for (const [table, columns] of Object.entries(CASCADE_CHILDREN)) {
      const where = columns.map((c) => `${c} = ANY($1::uuid[])`).join(' OR ');
      const res = await client.query(
        `SELECT count(*)::int AS n FROM chat.${table} WHERE ${where}`,
        [ids],
      );
      removed[table] = res.rows[0].n;
    }
  }

  await client.query(`DELETE FROM chat.users WHERE email LIKE $1`, [
    `%${TEST_DOMAIN}`,
  ]);

  // Second pass: conversations with no participants left are unreferenced
  // shells. `createdById` was already nulled by the cascade's SET NULL.
  const orphan = await client.query(`
    DELETE FROM chat.conversations c
    WHERE NOT EXISTS (
      SELECT 1 FROM chat.conversation_participants p
      WHERE p."conversationId" = c.id
    )
    RETURNING id
  `);
  removed.conversations = orphan.rowCount;

  await client.query('COMMIT');

  console.log('\x1b[32mDeleted:\x1b[0m');
  for (const [table, n] of Object.entries(removed)) {
    console.log(`  ${table.padEnd(24)}${n}`);
  }
  console.log('');

  const after = await client.query(`
    SELECT
      (SELECT count(*) FROM chat.users)                        AS users,
      (SELECT count(*) FROM chat.conversations)                AS conversations,
      (SELECT count(*) FROM chat.messages)                     AS messages,
      (SELECT count(*) FROM chat.calls)                        AS calls,
      (SELECT count(*) FROM chat.connections)                  AS connections,
      (SELECT count(*) FROM chat.auth_sessions)                AS sessions
  `);
  const a = after.rows[0];
  // Whole-table totals on purpose: this is the end state of a *shared*
  // database, and what is left should be the real accounts plus whatever they
  // own. Labelled explicitly so it is not read as leftover test data.
  console.log(
    '\x1b[1mRemaining (all accounts, including the ones spared above):\x1b[0m',
  );
  console.log(
    `  users ${a.users}, conversations ${a.conversations}, messages ${a.messages}, ` +
      `calls ${a.calls}, connections ${a.connections}, sessions ${a.sessions}\n`,
  );

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
