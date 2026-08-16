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
const openRouterOptions = {
  apiKey: env.OPENROUTER_API_KEY,
  baseUrl: env.OPENROUTER_BASE_URL,
  appName: `${env.OPENROUTER_APP_NAME} voice verifier`,
  ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
};
const seedTts = new OpenRouterTextToSpeechProvider(openRouterOptions);
const seed = await seedTts.synthesize({
  text: 'Olá, NOX. Que horas são agora?',
  model: env.MODEL_TTS,
  voice: env.VOICE_TTS_VOICE,
  format: 'mp3',
});

const app = buildApp(env);
const upload = multipartAudio(Buffer.from(seed.audio), seed.mimeType);
try {
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
    transcription?: string;
    assistantText?: string;
    conversationId?: string;
    requestId?: string;
    latencyMs?: unknown;
    audio?: { mimeType: string; data: string } | null;
  }>();
  if (response.statusCode < 200 || response.statusCode >= 300)
    throw new Error(`Provider verification failed: ${result.error ?? response.statusCode}`);
  if (!result.transcription || !result.assistantText || !result.audio)
    throw new Error('Provider verification returned an incomplete response');
  console.log(
    JSON.stringify(
      {
        sttModel: env.MODEL_STT,
        ttsModel: env.MODEL_TTS,
        transcription: result.transcription,
        assistantText: result.assistantText,
        conversationId: result.conversationId,
        requestId: result.requestId,
        latencyMs: result.latencyMs,
        audioMimeType: result.audio.mimeType,
        audioBytes: Buffer.from(result.audio.data, 'base64').byteLength,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}

function multipartAudio(audio: Buffer, mimeType: string) {
  const boundary = '----nox-real-voice-verifier';
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
