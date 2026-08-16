import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

const token = process.env.NOX_API_TOKEN;
const audioPath = process.env.VOICE_TEST_AUDIO_PATH;
if (!token) throw new Error('NOX_API_TOKEN is required');
if (!audioPath) throw new Error('VOICE_TEST_AUDIO_PATH is required');

const baseUrl = (process.env.NOX_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const audio = await readFile(audioPath);
const mimeType = mimeTypeForPath(audioPath);
const form = new FormData();
if (process.env.VOICE_CONVERSATION_ID)
  form.append('conversationId', process.env.VOICE_CONVERSATION_ID);
form.append('audio', new Blob([audio], { type: mimeType }), `voice${extname(audioPath)}`);

const response = await fetch(`${baseUrl}/v1/voice`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'x-session-id': randomUUID(),
  },
  body: form,
});
const result = (await response.json()) as {
  error?: string;
  type?: string;
  transcription?: string;
  assistantText?: string;
  conversationId?: string;
  requestId?: string;
  latencyMs?: unknown;
  audio?: { mimeType: string; data: string } | null;
};
if (!response.ok) {
  throw new Error(`Voice verification failed (${response.status}): ${result.error ?? 'unknown'}`);
}
if (!result.transcription || !result.assistantText || !result.conversationId || !result.requestId)
  throw new Error('Voice response is missing required metadata');

console.log(
  JSON.stringify(
    {
      status: response.status,
      type: result.type,
      transcription: result.transcription,
      assistantText: result.assistantText,
      conversationId: result.conversationId,
      requestId: result.requestId,
      latencyMs: result.latencyMs,
      audioMimeType: result.audio?.mimeType,
      audioBytes: result.audio ? Buffer.from(result.audio.data, 'base64').byteLength : 0,
    },
    null,
    2,
  ),
);

if (process.env.VOICE_OUTPUT_PATH && result.audio) {
  await writeFile(process.env.VOICE_OUTPUT_PATH, Buffer.from(result.audio.data, 'base64'));
  console.log(`Audio response written to ${process.env.VOICE_OUTPUT_PATH}`);
}

function mimeTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.wav':
      return 'audio/wav';
    case '.webm':
      return 'audio/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
    case '.mp4':
      return 'audio/mp4';
    default:
      throw new Error('VOICE_TEST_AUDIO_PATH must be WAV, WebM, MP3 or M4A');
  }
}
