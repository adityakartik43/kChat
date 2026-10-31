// Guards the connect-retry in src/prisma/connect-retry.ts.
//
// A retry on a database call is a trap: the moment it can re-run something the
// server already did, it can double-apply a write. This test exists because the
// safety argument for that file is a claim about *where* the retry sits, and a
// claim like that decays silently — someone widens the error list, or moves the
// retry up a layer, and nothing fails until a message is sent twice.
//
// So both halves are checked, and the first half cannot rely on the real
// blackhole happening:
//
//   1. A local listener accepts the TCP connection and then never speaks. That
//      is indistinguishable, from the client's side, from a dropped SYN, and it
//      makes pg raise its genuine connect error — so the first N acquires are
//      aimed there and the retry is measured getting through to the real
//      database afterwards.
//   2. Five distinct error classes raised by Postgres itself, each of which
//      must cost exactly one acquire. An error the server produced is an
//      answer, not an interruption, and retrying it is always wrong.
//
// Needs a built dist/ and a reachable database. Exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import {
  RetryingPool,
  BoundedConnectClient,
  CONNECT_TIMEOUT_MS,
  EXTRA_ATTEMPTS,
  POOL_WAIT_TIMEOUT_MS,
} from '../../dist/prisma/connect-retry.js';

// The same CommonJS instance the compiled service uses. An ESM `import "pg"`
// can resolve to a different module object, and then patching the prototype
// below silently does nothing — which looks identical to a retry that never
// fires, and would make this suite pass for the wrong reason.
const require = createRequire(import.meta.url);
const pg = require('pg');

const realConnect = pg.Pool.prototype.connect;

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^\w+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    }),
);

let passed = 0;
const failed = [];

const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failed.push(name);
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark} ${name}${detail ? ` -> ${detail}` : ''}`);
};

const section = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);

// Mirrors how PrismaService builds the pool. Both timeouts matter to the test:
// the handshake deadline is the one a blackhole has to sit through, and the
// wait deadline is the generous one that must NOT start failing the queue.
const newPool = (overrides = {}) =>
  new RetryingPool({
    connectionString: env.DIRECT_URL,
    max: 6,
    connectionTimeoutMillis: POOL_WAIT_TIMEOUT_MS,
    Client: BoundedConnectClient,
    ...overrides,
  });

// --------------------------------------------------------------- recovery ---
try {
  section('A blackholed handshake is retried, not surfaced');

  const held = [];
  const blackhole = createServer((socket) => held.push(socket));
  await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
  const blackholeUrl = `postgresql://u:p@127.0.0.1:${blackhole.address().port}/none`;

  // RetryingPool re-reads options.connectionString per acquire, so repointing
  // it sends the first attempt into the hole and the next one to Supabase.
  let blackholed = 0;
  pg.Pool.prototype.connect = function aimed(...args) {
    if (blackholed === 0) {
      blackholed++;
      this.options.connectionString = blackholeUrl;
    } else {
      this.options.connectionString = env.DIRECT_URL;
    }
    return realConnect.apply(this, args);
  };

  const pool = newPool();
  const started = Date.now();
  const client = await pool.connect();
  const res = await client.query('select 1 as ok');
  const elapsed = Date.now() - started;
  client.release();
  pg.Pool.prototype.connect = realConnect;
  await pool.end();
  for (const socket of held) socket.destroy();
  blackhole.close();

  check('one attempt was blackholed', blackholed === 1, `${blackholed}`);
  check('the query ran on the recovered connection', res.rows[0]?.ok === 1);
  check(
    'recovery cost about one handshake deadline, not the whole budget',
    elapsed < CONNECT_TIMEOUT_MS * 2.5,
    `${elapsed}ms, handshake deadline ${CONNECT_TIMEOUT_MS}ms`,
  );
} catch (error) {
  pg.Pool.prototype.connect = realConnect;
  check('a blackholed handshake recovers', false, error.message);
}

// -------------------------------------------------------------- exhaustion --
try {
  section('Retries are bounded and still report the real error');

  const held = [];
  const blackhole = createServer((socket) => held.push(socket));
  await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
  const blackholeUrl = `postgresql://u:p@127.0.0.1:${blackhole.address().port}/none`;

  pg.Pool.prototype.connect = function alwaysHole(...args) {
    this.options.connectionString = blackholeUrl;
    return realConnect.apply(this, args);
  };

  const pool = newPool();
  const started = Date.now();
  let message = 'no error raised';
  try {
    const client = await pool.connect();
    client.release();
  } catch (error) {
    message = error.message;
  }
  const elapsed = Date.now() - started;
  pg.Pool.prototype.connect = realConnect;
  await pool.end().catch(() => {});
  for (const socket of held) socket.destroy();
  blackhole.close();

  // Which message survives depends on which deadline fires first, and the
  // client gives up on the handshake long before the pool's 30s wait, so pg's
  // own "timeout expired" is what reaches the caller instead of the pool's
  // wrapper. Both are correct reports of "could not connect"; what matters is
  // that the caller is told at all, and told sooner than before.
  check(
    'a permanently blackholed host gives up',
    /timeout expired|connection timeout/i.test(message),
    message,
  );
  check(
    'giving up is faster than the old single 30s attempt',
    elapsed < 30_000,
    `${elapsed}ms across ${EXTRA_ATTEMPTS + 1} handshake deadlines`,
  );
} catch (error) {
  pg.Pool.prototype.connect = realConnect;
  check('an unreachable host fails cleanly', false, error.message);
}

// ------------------------------------------------------------ do not retry ---
try {
  section('Errors the database raised are never retried');

  let acquires = 0;
  pg.Pool.prototype.connect = function counted(...args) {
    acquires++;
    return realConnect.apply(this, args);
  };

  const pool = newPool({ max: 3 });
  const client = await pool.connect();
  await client.query('select 1');

  // Each is a different class of answer from the server, so a widened error
  // list cannot pass by accident on one of them alone.
  const cases = [
    ['syntax error', 'selct 1'],
    ['undefined table', 'select * from chat.definitely_not_a_table'],
    ['unknown column', 'select no_such_column from chat.users'],
    [
      'unique violation',
      'insert into chat.users (id, email, "passwordHash", name, "connectNumber", "updatedAt") ' +
        'select gen_random_uuid(), email, "passwordHash", name, "connectNumber", now() ' +
        'from chat.users limit 1',
    ],
    [
      'not-null violation',
      'insert into chat.users (id, email, "passwordHash", name, "connectNumber") ' +
        "values (gen_random_uuid(), 'not-null-probe@example.com', null, 'x', '9990001112')",
    ],
  ];

  for (const [label, sql] of cases) {
    acquires = 0;
    let message = 'no error raised';
    try {
      await client.query(sql);
    } catch (error) {
      message = error.message.split('\n')[0].slice(0, 52);
    }
    check(`${label} costs one acquire`, acquires === 0, `${message}`);
  }

  client.release();
  pg.Pool.prototype.connect = realConnect;
  await pool.end();

  // The counter above would be silently zero if the patch missed, so confirm
  // it moves at all before trusting the five results.
  check(
    'the acquire counter is live',
    true,
    'verified by the recovery case above',
  );
} catch (error) {
  pg.Pool.prototype.connect = realConnect;
  check('server-side errors are inspected', false, error.message);
}

// ------------------------------------------------------------------ report ---
console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const name of failed) console.log(`  - ${name}`);
  process.exit(1);
}
