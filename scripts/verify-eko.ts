import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { z } from 'zod';
import { buildApp } from '../apps/api/src/app.js';
import { loadEnv } from '@nox/shared';

const ambientResultSchema = z.object({
  decision: z.enum(['KEEP', 'DISCARD']),
  reason: z.string(),
  transcript: z.object({ text: z.string() }).optional(),
  memory: z
    .object({
      id: z.string().uuid(),
      type: z.string(),
      content: z.string(),
      importance: z.number(),
      confidence: z.number(),
    })
    .optional(),
});
const activeResultSchema = z.object({
  transcription: z.string().optional(),
  assistantText: z.string().optional(),
  confirmationId: z.string().uuid().optional(),
  latencyMs: z.record(z.string(), z.number()).optional(),
});

const audioArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
if (!audioArgument) {
  console.error(
    'Usage: pnpm verify:eko -- <audio.wav|webm|mp3|m4a> [--duration-ms=3000] [--active]',
  );
  process.exitCode = 1;
} else {
  const env = loadEnv();
  const audioPath = resolve(audioArgument);
  const audio = await readFile(audioPath);
  const mimeType = mimeTypeFor(audioPath);
  const durationMs = Number(
    process.argv.find((argument) => argument.startsWith('--duration-ms='))?.split('=')[1] ?? 3_000,
  );
  if (!Number.isInteger(durationMs) || durationMs < 100) throw new Error('Invalid --duration-ms');
  const app = buildApp(env);
  const authorization = { authorization: `Bearer ${env.NOX_API_TOKEN}` };
  try {
    const enabled = await app.inject({
      method: 'POST',
      url: '/v1/eko/state',
      headers: authorization,
      payload: { state: 'AMBIENT' },
    });
    ensureSuccess(enabled.statusCode, enabled.body, 'enable Eko');
    const upload = multipart(audio, mimeType, durationMs, false);
    const ambient = await app.inject({
      method: 'POST',
      url: '/v1/eko/segments',
      headers: { ...authorization, 'content-type': upload.contentType },
      payload: upload.body,
    });
    ensureSuccess(ambient.statusCode, ambient.body, 'ambient pipeline');
    const ambientResult = ambientResultSchema.parse(JSON.parse(ambient.body) as unknown);
    console.log(
      JSON.stringify(
        {
          ambient: {
            decision: ambientResult.decision,
            reason: ambientResult.reason,
            transcript: ambientResult.transcript?.text,
            memory: ambientResult.memory
              ? {
                  id: ambientResult.memory.id,
                  type: ambientResult.memory.type,
                  content: ambientResult.memory.content,
                  importance: ambientResult.memory.importance,
                  confidence: ambientResult.memory.confidence,
                }
              : undefined,
          },
        },
        null,
        2,
      ),
    );
    if (process.argv.includes('--active')) {
      const activeUpload = multipart(audio, mimeType, durationMs, true);
      const active = await app.inject({
        method: 'POST',
        url: '/v1/voice',
        headers: { ...authorization, 'content-type': activeUpload.contentType },
        payload: activeUpload.body,
      });
      ensureSuccess(active.statusCode, active.body, 'ACTIVE voice pipeline');
      const activeResult = activeResultSchema.parse(JSON.parse(active.body) as unknown);
      console.log(
        JSON.stringify(
          {
            active: {
              transcription: activeResult.transcription,
              assistantText: activeResult.assistantText,
              confirmationId: activeResult.confirmationId,
              latencyMs: activeResult.latencyMs,
            },
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await app.inject({
      method: 'POST',
      url: '/v1/eko/state',
      headers: authorization,
      payload: { state: 'OFF' },
    });
    await app.close();
  }
}

function multipart(audio: Buffer, mimeType: string, durationMs: number, active: boolean) {
  const boundary = `----nox-eko-verifier-${Date.now()}`;
  const fields = active
    ? []
    : [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="durationMs"\r\n\r\n${durationMs}\r\n`,
        ),
      ];
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      ...fields,
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio${extensionForMime(mimeType)}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

function mimeTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.wav':
      return 'audio/wav';
    case '.webm':
      return 'audio/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    default:
      throw new Error('Unsupported audio extension');
  }
}

function extensionForMime(mimeType: string): string {
  return mimeType === 'audio/wav'
    ? '.wav'
    : mimeType === 'audio/webm'
      ? '.webm'
      : mimeType === 'audio/mpeg'
        ? '.mp3'
        : '.m4a';
}

function ensureSuccess(statusCode: number, body: string, stage: string): void {
  if (statusCode < 200 || statusCode >= 300)
    throw new Error(`${stage} failed (${statusCode}): ${body}`);
}
