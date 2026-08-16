import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_VERSION: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().optional(),
  PERSISTENCE_DRIVER: z.enum(['in-memory', 'postgres']).default('in-memory'),
  RUN_DATABASE_MIGRATIONS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_MIGRATIONS_PATH: z.string().optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default('openai/gpt-4.1-mini'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_SITE_URL: z.string().url().optional(),
  OPENROUTER_APP_NAME: z.string().default('NOX'),
  NOX_API_TOKEN: z.string().min(32),
  NOX_USER_ID: z.string().min(1).max(128).default('owner'),
  NOX_DEVICE_ID: z.string().min(1).max(128).default('primary'),
  ACTION_TOOLS_AUTO_ALLOWED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CONFIRMATION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
});
export type Env = z.infer<typeof envSchema>;
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
