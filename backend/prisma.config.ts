import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
  },

  datasource: {
    // Supabase's shared transaction pooler (PgBouncer) cannot run
    // migrations/DDL, so migrations use the session-mode direct URL.
    url: env('DIRECT_URL'),
  },
});
