export interface EnvConfig {
  DATABASE_URL: string;
  DIRECT_URL?: string;
  PORT: number;
  NODE_ENV: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;
  CORS_ORIGIN: string;
}

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

  for (const key of required) {
    if (!config[key] || typeof config[key] !== 'string') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const accessSecret = config.JWT_ACCESS_SECRET as string;
  const refreshSecret = config.JWT_REFRESH_SECRET as string;

  if (accessSecret === refreshSecret) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
    );
  }

  const port = Number(config.PORT ?? 4000);
  if (Number.isNaN(port)) {
    throw new Error('PORT must be a valid number');
  }

  return {
    DATABASE_URL: config.DATABASE_URL as string,
    DIRECT_URL: config.DIRECT_URL as string | undefined,
    PORT: port,
    NODE_ENV: (config.NODE_ENV as string) ?? 'development',
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: refreshSecret,
    JWT_ACCESS_EXPIRES_IN: (config.JWT_ACCESS_EXPIRES_IN as string) ?? '15m',
    JWT_REFRESH_EXPIRES_IN: (config.JWT_REFRESH_EXPIRES_IN as string) ?? '30d',
    CORS_ORIGIN: (config.CORS_ORIGIN as string) ?? '*',
  };
}
