import 'dotenv/config';
import { loadEnv } from '@nox/shared';
import { buildApp } from './app.js';

const env = loadEnv();
const app = buildApp(env);
await app.listen({ host: env.HOST, port: env.PORT });
