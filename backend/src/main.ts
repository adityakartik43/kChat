import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

/**
 * Turn a comma-separated CORS_ORIGIN list into something Nest's CORS layer
 * accepts, supporting a single `*` wildcard per entry.
 *
 *   CORS_ORIGIN=http://localhost:3000,http://192.168.1.*:3000
 *     -> [ 'http://localhost:3000', /^http:\/\/192\.168\.1\..*:3000$/ ]
 *
 * The subnet form matters on a DHCP network: pinning the exact LAN IP
 * silently breaks CORS for everyone the moment the address changes.
 */
function parseCorsOrigins(value: string): true | Array<string | RegExp> {
  if (value.trim() === '*') return true;

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!entry.includes('*')) return entry;

      // Escape everything except the wildcards, then let `*` match any run
      // of characters. A fullmatch keeps a stray subdomain from matching.
      const source = entry
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');

      return new RegExp(`^${source}$`);
    });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      // The API is consumed by a separate Next.js origin, so it does not
      // need to serve HTML documents.
      contentSecurityPolicy: false,
    }),
  );

  const corsOrigin = process.env.CORS_ORIGIN ?? '*';

  app.enableCors({
    origin: parseCorsOrigins(corsOrigin),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Lets the Socket.IO layer and Nest share one port.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  // 0.0.0.0 by default so the API is reachable from the LAN, not just
  // loopback. Override with HOST=127.0.0.1 to keep it local-only.
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);

  console.log(`CONNECT api listening on http://${host}:${port}`);
}

void bootstrap();
