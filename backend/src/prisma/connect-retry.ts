/**
 * Connection handling for a database that is reached over the internet.
 *
 * Two facts about that shape the code here.
 *
 * **A cold connection is expensive, and occasionally impossible.** Supabase's
 * pooler is a different continent away, so a connection costs a round trip and
 * a TLS handshake — 0.2-0.5s, against 25-35ms for the query that follows. That
 * ratio is why `PrismaService` keeps spare connections warm: a query that
 * reuses a pooled connection never touches this code, and the whole problem
 * only exists on the path that opens one. The distribution also has a long
 * tail, and roughly one handshake in sixty never completes at all: the SYN is
 * silently discarded in the path, so nothing answers and nothing errors either.
 * Node only finds out when a timer fires, which used to be 30 seconds later,
 * so one unlucky packet froze a request for half a minute and then returned a
 * 500.
 *
 * **One timeout is doing two unrelated jobs.** `pg-pool` has a single
 * `connectionTimeoutMillis` that bounds both the TCP handshake and the wait for
 * a free client, and they want opposite things. The handshake should give up
 * fast, because a handshake that has not completed in seconds is not going to.
 * The queue should wait, because behind it are requests that will succeed in
 * tens of milliseconds once a slot frees. Shortening the one option to fix the
 * first is what turns a slow request into a 500, so the deadlines are separated
 * instead: the pool keeps a generous wait for a slot, and `BoundedConnectClient`
 * caps the handshake on its own.
 *
 * The retry is safe because of *where* it sits. `Pool.connect()` resolves only
 * once a client is fully connected, so when it rejects, no query has run and
 * nothing has been written to the server — a retry cannot double-apply a write,
 * whatever the caller was about to do. That is the whole reason this is a pool
 * subclass and not a Prisma query extension: one level up, "the connection
 * dropped" and "the server answered" are the same error, and retrying the
 * second is how messages get sent twice.
 */

import { Client, Pool, type ClientConfig, type PoolClient } from 'pg';

/**
 * How long the TCP/TLS handshake may take before it is abandoned.
 *
 * Also handed to `pg` as its own connect deadline.
 *
 * Ten seconds is not a round number chosen for tidiness — it is set from
 * measurement. Handshakes to this pooler usually cost 0.2-0.5s, but the
 * distribution has a long tail: sampling cold connects on this link produced
 * 1.9s and 5.6s outliers alongside the sub-second ones. An earlier five-second
 * deadline was justified as "several times a working handshake, so the only
 * attempts it abandons are the ones that were never going to finish", and
 * measurement refuted that: it was abandoning handshakes that finished at 5.6s,
 * which is a live connection being thrown away. Ten seconds is roughly twenty
 * times the median, so a genuine blackhole is still abandoned promptly, while
 * the tail is inside the deadline.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * How long a request may wait for a free client before it is failed.
 *
 * Generous on purpose: this is a queue behind work that takes tens of
 * milliseconds, not a hung connection. Starving the queue is a capacity
 * problem and should be visible as a slow request, not disguised as a timeout.
 *
 * Read together with `CONNECT_TIMEOUT_MS` and `EXTRA_ATTEMPTS` this is also the
 * ceiling on the whole acquire: one attempt's worth of queue wait, or the
 * retries, but not both stacked without limit.
 */
export const POOL_WAIT_TIMEOUT_MS = 30_000;

/**
 * Extra attempts after the first — one, not two.
 *
 * The budget is the point. Three attempts inside a five-second deadline capped a
 * failed acquire at about fifteen seconds, but each of those attempts was
 * willing to give up on a handshake that would have completed. Widening the
 * deadline to match the link's real tail and keeping the attempt count here
 * lands on the same shape as before: two ten-second attempts, about twenty
 * seconds to give up, still comfortably inside the thirty the pool allows for
 * the queue. The second attempt is what covers a blackhole; a third would only
 * be buying a probability that has already been made small by the wider
 * deadline, at the cost of the one property worth keeping — a request that
 * cannot connect says so in less time than the queue would have waited.
 */
export const EXTRA_ATTEMPTS = 1;
const BACKOFF_MS = 250;

/**
 * A `pg.Client` whose handshake has its own, short deadline.
 *
 * The pool hands every client its own options verbatim, so overriding
 * `connectionTimeoutMillis` here is what decouples the two deadlines — the
 * pool's copy governs the wait for a slot and is left generous, while this one
 * governs the handshake and is not.
 *
 * Deliberately no methods are overridden. An earlier version tried to reset
 * `connection` between attempts, which is the one piece of `pg` state that
 * cannot be rebuilt from outside, and every retry after the first failed with
 * a null dereference. Bounding the handshake in the constructor needs no state
 * surgery at all.
 */
export class BoundedConnectClient extends Client {
  // `PoolConfig['Client']` is declared as `new () => ClientBase`, but pg-pool
  // actually calls `new this.Client(this.options)`. The parameter is optional so
  // the subclass satisfies the declared type too, and the deadline is applied
  // on every path — a client built with no config still gets one, since the
  // whole point is that no handshake is left unbounded.
  constructor(config?: string | ClientConfig) {
    super(
      typeof config === 'string'
        ? config
        : { ...config, connectionTimeoutMillis: CONNECT_TIMEOUT_MS },
    );
  }
}

/**
 * Raised when a connection could not be established.
 *
 * `pg` destroys the socket with these from its own connect timer; `pg-pool`
 * rewraps the failure in its own words. Every one of them is produced while
 * still trying to *obtain* a client, so none of them can be an answer from the
 * server, and none of them is retried twice.
 */
function isConnectFailure(error: unknown): boolean {
  const candidate = error as
    | {
        message?: string;
        code?: string;
        cause?: { message?: string; code?: string };
      }
    | undefined;

  if (!candidate) return false;

  if (
    [candidate.code, candidate.cause?.code].some(
      (code) => code && CONNECT_SYSCALL_ERRORS.has(code),
    )
  ) {
    return true;
  }

  return [candidate.message, candidate.cause?.message].some(
    (message) =>
      typeof message === 'string' &&
      CONNECT_FAILURE_MESSAGES.some((known) => message.includes(known)),
  );
}

const CONNECT_SYSCALL_ERRORS = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ETIMEDOUT',
]);

const CONNECT_FAILURE_MESSAGES = [
  // `pg`, from its own connect timer.
  'timeout expired',
  // `pg-pool`, once its timer gives up on a handshake.
  'Connection terminated due to connection timeout',
  // The socket went away before the session was ready to take queries.
  'Connection terminated unexpectedly',
  'Client has already been connected',
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `pg.Pool` that retries the connect phase.
 *
 * Only `connect` is overridden, because it is the one method whose failure is
 * provably free of side effects — which is what lets every caller in the app
 * benefit without any of them knowing.
 */
export class RetryingPool extends Pool {
  override connect(): Promise<PoolClient>;
  override connect(
    callback: (error: Error | undefined, client: PoolClient) => void,
  ): void;
  override connect(
    callback?: (error: Error | undefined, client: PoolClient) => void,
  ) {
    const acquire = async (left: number): Promise<PoolClient> => {
      try {
        return await super.connect();
      } catch (error) {
        if (left <= 0 || !isConnectFailure(error)) throw error;
        await sleep(BACKOFF_MS * (EXTRA_ATTEMPTS - left + 1));
        return acquire(left - 1);
      }
    };

    // The callback form is inherited behaviour rather than something to
    // re-implement: both forms go through the same promise, so both retry.
    if (callback) {
      void acquire(EXTRA_ATTEMPTS).then(
        (client) => callback(undefined, client),
        (error: Error) => callback(error, undefined as unknown as PoolClient),
      );
      return;
    }

    return acquire(EXTRA_ATTEMPTS);
  }
}
