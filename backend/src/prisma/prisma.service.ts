import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import {
  BoundedConnectClient,
  POOL_WAIT_TIMEOUT_MS,
  RetryingPool,
} from './connect-retry';

/**
 * How many pooled connections to hold open.
 *
 * Enough to cover ordinary traffic without ever queueing, small enough to be
 * invisible next to `max`. Idle ones cost a session on the pooler and nothing
 * else, which is the right trade against a handshake that can fail.
 */
const WARM_POOL_SIZE = 4;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: RetryingPool;

  constructor() {
    // Session-mode pooler (DIRECT_URL) is required for Prisma interactive
    // transactions; fall back to DATABASE_URL for direct connections.
    const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        'DATABASE_URL or DIRECT_URL environment variable must be set',
      );
    }

    const pool = new RetryingPool({
      connectionString,
      max: 10,
      // Spare connections, kept open on purpose.
      //
      // `pg-pool` closes idle clients after `idleTimeoutMillis` but never drops
      // below `min`, so this is a warm floor: the common case — a request that
      // finds a pooled connection and runs its query in tens of milliseconds —
      // stops depending on a handshake to another continent entirely. That
      // matters more than it looks, because the handshakes are the only part of
      // this path with a failure mode at all. `min` does not pre-create anything
      // (see `onModuleInit`), it only sets the floor to fall back to.
      min: WARM_POOL_SIZE,
      // This bounds the wait for a free client, not the handshake — see
      // ./connect-retry.ts. It stays generous because the queue is in front of
      // work that takes tens of milliseconds, and a burst that briefly outruns
      // the pool should be a slow request rather than a 500.
      connectionTimeoutMillis: POOL_WAIT_TIMEOUT_MS,
      // The handshake gets its own, much longer deadline, which the pool cannot
      // express: it hands every client these options verbatim, so the client is
      // what narrows its own copy. "Much longer" is relative to the pool's
      // 30s; relative to a 0.3s handshake it is still short, and it is set from
      // the measured tail rather than a guess.
      Client: BoundedConnectClient,
      // The app owns the "chat" schema (see prisma/schema.prisma). Prisma
      // emits schema-qualified SQL for the models it generates, but hand
      // written $queryRaw and any future ad-hoc SQL may not be qualified,
      // so pin the search_path. "public" stays on the path so Supabase's
      // own extensions and helper functions remain resolvable.
      options: '-c search_path=chat,public',
    });

    super({ adapter: new PrismaPg(pool) });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    await this.warmPool();
  }

  /**
   * Opens the warm floor up front, so the cost lands at boot rather than in
   * the middle of a burst.
   *
   * Without this the pool is empty for the first few seconds of every process,
   * and a burst of concurrent requests all discover that at once: ten
   * handshakes racing the same path, each exposed to its tail, is how a burst
   * turns into a wave of failures instead of a slow first request. Paying for
   * them here means the first real request finds a connection.
   *
   * Deliberately not fatal. The database being unreachable at boot is a reason
   * to start degraded and serve what can be served, not a reason to refuse to
   * start — the handshake retry and the warm floor both exist to keep the app
   * useful through a bad patch, and throwing here would defeat that.
   */
  private async warmPool(): Promise<void> {
    const warming = Array.from({ length: WARM_POOL_SIZE }, () =>
      this.pool.connect(),
    );
    const settled = await Promise.allSettled(warming);

    for (const result of settled) {
      if (result.status === 'fulfilled') result.value.release();
    }

    const failed = settled.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(
        `${WARM_POOL_SIZE - failed} of ${WARM_POOL_SIZE} warm database ` +
          `connections are open; ${failed} could not be established. Requests ` +
          `will open connections on demand until the link recovers.`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
