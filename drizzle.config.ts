import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for database commands');
export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/database/src/index.ts',
  out: './packages/database/drizzle',
  dbCredentials: { url: process.env.DATABASE_URL },
});
