import { z } from 'zod';

const optionalModel = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalReasoningEffort = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
);

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
  OPENROUTER_MODEL: z.string().default('openai/gpt-5.6-luna'),
  MODEL_DEFAULT: optionalModel,
  MODEL_FAST: optionalModel,
  MODEL_REASONING: optionalModel,
  MODEL_CODING: optionalModel,
  MODEL_FAST_REASONING_EFFORT: optionalReasoningEffort,
  MODEL_DEFAULT_REASONING_EFFORT: optionalReasoningEffort,
  MODEL_REASONING_REASONING_EFFORT: optionalReasoningEffort,
  MODEL_CODING_REASONING_EFFORT: optionalReasoningEffort,
  MODEL_VISION: optionalModel,
  MODEL_MEMORY: optionalModel,
  MODEL_STT: z.string().min(1).default('openai/gpt-4o-mini-transcribe'),
  MODEL_TTS: z.string().min(1).default('hexgrad/kokoro-82m'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_SITE_URL: z.string().url().optional(),
  OPENROUTER_APP_NAME: z.string().default('NOX'),
  NOX_API_TOKEN: z.string().min(32),
  NOX_USER_ID: z.string().min(1).max(128).default('owner'),
  NOX_DEVICE_ID: z.string().min(1).max(128).default('primary'),
  CLIMATE_DRIVER: z.enum(['mock', 'bridge']).default('mock'),
  NOX_DEVICE_BRIDGE_TOKEN: optionalModel,
  NOX_DEVICE_BRIDGE_ID: z.string().min(1).max(128).default('home'),
  NOX_CLIMATE_DEVICE_ID: z.string().min(1).max(128).default('home-ac'),
  DEVICE_BRIDGE_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(45_000),
  DEVICE_BRIDGE_LONG_POLL_MS: z.coerce.number().int().min(1_000).max(60_000).default(25_000),
  ACTION_TOOLS_AUTO_ALLOWED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CONFIRMATION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  CONVERSATION_CONTEXT_MESSAGES: z.coerce.number().int().positive().max(100).default(20),
  VOICE_LANGUAGE: z
    .string()
    .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)
    .default('pt'),
  VOICE_TTS_VOICE: z.string().min(1).max(128).default('pf_dora'),
  VOICE_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_024).max(10_000_000).default(2_000_000),
  VOICE_MAX_TTS_CHARACTERS: z.coerce.number().int().min(100).max(10_000).default(4_000),
});
export type Env = z.infer<typeof envSchema>;
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
