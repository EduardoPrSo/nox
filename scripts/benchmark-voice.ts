import 'dotenv/config';
import { OpenRouterTextToSpeechProvider } from '@nox/voice';
import { loadEnv } from '@nox/shared';
import { buildApp } from '../apps/api/src/app.js';

const configured = loadEnv();
const env = {
  ...configured,
  NODE_ENV: 'test' as const,
  PERSISTENCE_DRIVER: 'in-memory' as const,
  RUN_DATABASE_MIGRATIONS: false,
};
const samples = positiveInteger(process.env.VOICE_BENCHMARK_SAMPLES, 5);
const ttsSamples = positiveInteger(process.env.VOICE_BENCHMARK_TTS_SAMPLES, 3);
const speechOptions = {
  apiKey: env.OPENROUTER_API_KEY,
  baseUrl: env.OPENROUTER_BASE_URL,
  appName: `${env.OPENROUTER_APP_NAME} voice benchmark`,
  ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
};
const tts = new OpenRouterTextToSpeechProvider(speechOptions);
const seed = await tts.synthesize({
  text: 'NOX, que horas são agora?',
  model: env.MODEL_TTS,
  voice: env.VOICE_TTS_VOICE,
  format: 'mp3',
});
const app = buildApp(env);
const calls: Array<{
  latencyMs: { stt: number; agent: number; tts: number; total: number };
  assistantText: string;
  audioBytes: number;
}> = [];

try {
  for (let sample = 0; sample < samples; sample++) {
    const upload = multipartAudio(Buffer.from(seed.audio), seed.mimeType);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: {
        authorization: `Bearer ${env.NOX_API_TOKEN}`,
        'content-type': upload.contentType,
      },
      payload: upload.body,
    });
    const result = response.json<{
      error?: string;
      assistantText?: string;
      latencyMs?: { stt: number; agent: number; tts: number; total: number };
      audio?: { data: string };
    }>();
    if (!response.statusCode.toString().startsWith('2') || !result.latencyMs || !result.audio)
      throw new Error(`Voice benchmark failed: ${result.error ?? response.statusCode}`);
    calls.push({
      latencyMs: result.latencyMs,
      assistantText: result.assistantText ?? '',
      audioBytes: Buffer.from(result.audio.data, 'base64').byteLength,
    });
  }
} finally {
  await app.close();
}

const ttsFormats = await Promise.all(
  (['mp3', 'pcm'] as const).map(async (format) => {
    const results: Array<{ latencyMs: number; bytes: number }> = [];
    const errors: string[] = [];
    for (let sample = 0; sample < ttsSamples; sample++) {
      try {
        const result = await tts.synthesize({
          text: 'Pronto, 23 graus.',
          model: env.MODEL_TTS,
          voice: env.VOICE_TTS_VOICE,
          format,
        });
        results.push({ latencyMs: result.usage.latencyMs, bytes: result.audio.byteLength });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return {
      format,
      samples: results.length,
      errors,
      latencyMs: summarize(results.map((result) => result.latencyMs)),
      averageRawBytes: Math.round(average(results.map((result) => result.bytes))),
      averageBase64Bytes: Math.round(
        average(results.map((result) => Math.ceil(result.bytes / 3) * 4)),
      ),
    };
  }),
);

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      samples,
      models: {
        stt: env.MODEL_STT,
        agent: env.MODEL_FAST ?? env.MODEL_DEFAULT ?? env.OPENROUTER_MODEL,
        tts: env.MODEL_TTS,
      },
      latencyMs: {
        stt: summarize(calls.map((call) => call.latencyMs.stt)),
        agent: summarize(calls.map((call) => call.latencyMs.agent)),
        tts: summarize(calls.map((call) => call.latencyMs.tts)),
        total: summarize(calls.map((call) => call.latencyMs.total)),
      },
      assistantCharacters: summarize(calls.map((call) => [...call.assistantText].length)),
      audioBytes: summarize(calls.map((call) => call.audioBytes)),
      responses: calls.map((call) => call.assistantText),
      ttsFormatComparison: ttsFormats,
    },
    null,
    2,
  ),
);

function summarize(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20)
    throw new Error('Benchmark sample counts must be integers between 1 and 20');
  return parsed;
}

function multipartAudio(audio: Buffer, mimeType: string) {
  const boundary = '----nox-voice-benchmark';
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="seed.mp3"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
