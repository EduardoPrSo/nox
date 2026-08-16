import 'dotenv/config';
import { migratePostgres } from '@nox/database';
import { loadEnv } from '@nox/shared';
import { buildApp } from './app.js';

const env = loadEnv();
if (env.PERSISTENCE_DRIVER === 'postgres' && env.RUN_DATABASE_MIGRATIONS) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL migrations');
  await migratePostgres(env.DATABASE_URL, env.DATABASE_MIGRATIONS_PATH);
}
const app = buildApp(env);
await app.listen({ host: env.HOST, port: env.PORT });
