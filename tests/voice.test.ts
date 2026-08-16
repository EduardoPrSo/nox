import type { AIProvider, ChatRequest, ChatResponse } from '@nox/ai';
import { InMemoryMemoryStore } from '@nox/memory';
import { loadEnv } from '@nox/shared';
import { InMemoryAIUsageRepository, type AIUsageRepository } from '@nox/usage';
import type {
  SpeechSynthesisRequest,
  SpeechToTextProvider,
  TextToSpeechProvider,
  TranscriptionRequest,
} from '@nox/voice';
import {
  OpenRouterSpeechToTextProvider,
  OpenRouterTextToSpeechProvider,
  validateVoiceAudio,
} from '@nox/voice';
import { buildApp } from '../apps/api/src/app.js';

class QueueProvider implements AIProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly responses: ChatResponse[]) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('No queued response');
    return response;
  }
  async *stream(): AsyncIterable<string> {
    yield '';
  }
}

class MockStt implements SpeechToTextProvider {
  readonly requests: TranscriptionRequest[] = [];
  constructor(
    private readonly text = 'Olá por voz',
    private readonly failure?: Error,
  ) {}
  async transcribe(request: TranscriptionRequest) {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    return {
      text: this.text,
      usage: {
        provider: 'mock-stt',
        model: request.model,
        inputTokens: 12,
        totalTokens: 12,
        inputUnits: '1.25',
        unit: 'seconds',
        latencyMs: 3,
        cost: '0.00001',
      },
    };
  }
}

class MockTts implements TextToSpeechProvider {
  readonly requests: SpeechSynthesisRequest[] = [];
  constructor(private readonly failure?: Error) {}
  async synthesize(request: SpeechSynthesisRequest) {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    return {
      audio: Uint8Array.of(0x49, 0x44, 0x33, 1, 2, 3),
      mimeType: 'audio/mpeg',
      usage: {
        provider: 'mock-tts',
        model: request.model,
        inputUnits: String([...request.text].length),
        unit: 'characters',
        latencyMs: 4,
      },
    };
  }
}

const env = loadEnv({
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'test',
  OPENROUTER_MODEL: 'test-chat',
  MODEL_STT: 'test-stt',
  MODEL_TTS: 'test-tts',
  OPENROUTER_BASE_URL: 'https://example.com',
  NOX_API_TOKEN: 'test-token-with-at-least-32-characters',
});
const authorization = { authorization: `Bearer ${env.NOX_API_TOKEN}` };

describe('Voice API', () => {
  it('requires authentication before accepting an upload', async () => {
    const app = voiceApp();
    const response = await app.inject({ method: 'POST', url: '/v1/voice' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects missing multipart, unsupported MIME, invalid bytes and oversized audio', async () => {
    const app = voiceApp({ env: { ...env, VOICE_MAX_UPLOAD_BYTES: 64 } });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/voice',
          headers: authorization,
          payload: {},
        })
      ).statusCode,
    ).toBe(415);

    const unsupported = multipartAudio(Buffer.alloc(44), 'text/plain');
    const unsupportedResponse = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': unsupported.contentType },
      payload: unsupported.body,
    });
    expect(unsupportedResponse.statusCode).toBe(415);
    expect(unsupportedResponse.json()).toEqual({ error: 'UNSUPPORTED_AUDIO_TYPE' });

    const invalid = multipartAudio(Buffer.alloc(44), 'audio/wav');
    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': invalid.contentType },
      payload: invalid.body,
    });
    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toEqual({ error: 'INVALID_AUDIO' });

    const oversized = multipartAudio(validWav(80), 'audio/wav');
    const oversizedResponse = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': oversized.contentType },
      payload: oversized.body,
    });
    expect(oversizedResponse.statusCode).toBe(413);
    expect(oversizedResponse.json()).toMatchObject({ error: 'AUDIO_TOO_LARGE', maxBytes: 64 });
    await app.close();
  });

  it('runs STT, the shared agent and TTS with correlated usage', async () => {
    const usage = new InMemoryAIUsageRepository();
    const provider = new QueueProvider([
      {
        message: { role: 'assistant', content: 'Olá! Como posso ajudar?' },
        usage: {
          provider: 'mock-chat',
          model: 'test-chat',
          inputTokens: 5,
          outputTokens: 6,
          totalTokens: 11,
          latencyMs: 2,
        },
      },
    ]);
    const stt = new MockStt('Oi, NOX');
    const tts = new MockTts();
    const app = buildApp(env, { provider, stt, tts, usage });
    const payload = multipartAudio(validWav(), 'audio/wav');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: {
        ...authorization,
        'content-type': payload.contentType,
        'x-session-id': '11111111-1111-4111-8111-111111111111',
      },
      payload: payload.body,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      type: string;
      transcription: string;
      assistantText: string;
      conversationId: string;
      requestId: string;
      audio: { mimeType: string; data: string };
      latencyMs: Record<string, number>;
    }>();
    expect(body).toMatchObject({
      type: 'message',
      transcription: 'Oi, NOX',
      assistantText: 'Olá! Como posso ajudar?',
      audio: {
        mimeType: 'audio/mpeg',
        data: Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]).toString('base64'),
      },
    });
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.values(body.latencyMs).every((value) => typeof value === 'number')).toBe(true);
    expect(stt.requests[0]).toMatchObject({ model: 'test-stt', format: 'wav', language: 'pt' });
    expect(tts.requests[0]).toMatchObject({
      model: 'test-tts',
      voice: env.VOICE_TTS_VOICE,
      format: 'mp3',
    });
    expect(usage.records.map((item) => item.capability).sort()).toEqual(['DEFAULT', 'STT', 'TTS']);
    expect(new Set(usage.records.map((item) => item.requestId))).toEqual(new Set([body.requestId]));
    expect(usage.records.find((item) => item.capability === 'STT')).toMatchObject({
      conversationId: body.conversationId,
      inputUnits: '1.25',
      unit: 'seconds',
    });
    await app.close();
  });

  it('shares conversation memory between text and voice', async () => {
    const memory = new InMemoryMemoryStore();
    const provider = new QueueProvider([
      { message: { role: 'assistant', content: 'Primeira resposta.' } },
      { message: { role: 'assistant', content: 'Resposta por voz.' } },
      { message: { role: 'assistant', content: 'Resposta final por texto.' } },
    ]);
    const app = buildApp(env, {
      provider,
      memory,
      stt: new MockStt('Continue por voz'),
      tts: new MockTts(),
    });
    const textResponse = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: authorization,
      payload: { message: 'Comece por texto' },
    });
    const conversationId = textResponse.json<{ conversationId: string }>().conversationId;
    const upload = multipartAudio(validWav(), 'audio/wav', conversationId);
    const voiceResponse = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': upload.contentType },
      payload: upload.body,
    });

    expect(voiceResponse.statusCode).toBe(200);
    expect(voiceResponse.json()).toMatchObject({
      conversationId,
      assistantText: 'Resposta por voz.',
    });
    expect(provider.requests[1]?.messages.slice(1)).toEqual([
      { role: 'user', content: 'Comece por texto' },
      { role: 'assistant', content: 'Primeira resposta.' },
      { role: 'user', content: 'Continue por voz' },
    ]);

    const finalTextResponse = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: authorization,
      payload: { conversationId, message: 'Agora continue por texto' },
    });
    expect(finalTextResponse.statusCode).toBe(200);
    expect(provider.requests[2]?.messages.slice(1)).toEqual([
      { role: 'user', content: 'Comece por texto' },
      { role: 'assistant', content: 'Primeira resposta.' },
      { role: 'user', content: 'Continue por voz' },
      { role: 'assistant', content: 'Resposta por voz.' },
      { role: 'user', content: 'Agora continue por texto' },
    ]);
    const persisted = await memory.getConversationContext(conversationId, env.NOX_USER_ID, 20);
    expect(JSON.stringify(persisted)).not.toContain(
      Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]).toString('base64'),
    );
    await app.close();
  });

  it('executes a READ tool through the shared runtime', async () => {
    const provider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'voice-read', name: 'get_current_time', arguments: { timezone: 'UTC' } },
          ],
        },
      },
      { message: { role: 'assistant', content: 'Consultei a hora.' } },
    ]);
    const app = buildApp(env, {
      provider,
      stt: new MockStt('Que horas são?'),
      tts: new MockTts(),
    });
    const upload = multipartAudio(validWav(), 'audio/wav');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': upload.contentType },
      payload: upload.body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ assistantText: 'Consultei a hora.' });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages.some((message) => message.role === 'tool')).toBe(true);
    await app.close();
  });

  it('uses the same tools and keeps action tools behind explicit confirmation', async () => {
    const provider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'voice-action',
              name: 'send_message_mock',
              arguments: { recipient: 'Ana', message: 'Estou chegando.' },
            },
          ],
        },
      },
      { message: { role: 'assistant', content: 'Mensagem enviada.' } },
    ]);
    const tts = new MockTts();
    const app = buildApp(env, {
      provider,
      stt: new MockStt('Avise a Ana que estou chegando'),
      tts,
    });
    const upload = multipartAudio(validWav(), 'audio/wav');
    const pendingResponse = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': upload.contentType },
      payload: upload.body,
    });
    const pending = pendingResponse.json<{
      type: string;
      confirmationId: string;
      assistantText: string;
    }>();
    expect(pendingResponse.statusCode).toBe(200);
    expect(pending.type).toBe('confirmation_required');
    expect(pending.assistantText).toContain('Preciso da sua confirmação');
    expect(provider.requests).toHaveLength(1);
    expect(tts.requests).toHaveLength(1);

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/confirmations/${pending.confirmationId}`,
      headers: authorization,
      payload: { approved: true },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ type: 'message', content: 'Mensagem enviada.' });
    expect(provider.requests).toHaveLength(2);
    await app.close();
  });

  it('returns controlled STT and non-retryable partial TTS failures', async () => {
    const sttFailureApp = voiceApp({ stt: new MockStt('', new Error('stt down')) });
    const upload = multipartAudio(validWav(), 'audio/wav');
    const sttFailure = await sttFailureApp.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': upload.contentType },
      payload: upload.body,
    });
    expect(sttFailure.statusCode).toBe(502);
    expect(sttFailure.json()).toEqual({ error: 'STT_FAILED', retryable: true });
    await sttFailureApp.close();

    const ttsFailureApp = voiceApp({ tts: new MockTts(new Error('tts down')) });
    const ttsFailure = await ttsFailureApp.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': upload.contentType },
      payload: upload.body,
    });
    expect(ttsFailure.statusCode).toBe(502);
    expect(ttsFailure.json()).toMatchObject({
      error: 'TTS_FAILED',
      retryable: false,
      transcription: 'Olá por voz',
      assistantText: 'Resposta do NOX.',
      audio: null,
    });
    await ttsFailureApp.close();
  });

  it('keeps voice responses working when telemetry persistence fails', async () => {
    const failingUsage: AIUsageRepository = {
      async record() {
        throw new Error('telemetry down');
      },
    };
    const app = voiceApp({ usage: failingUsage });
    const upload = multipartAudio(validWav(), 'audio/wav');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/voice',
      headers: { ...authorization, 'content-type': upload.contentType },
      payload: upload.body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ assistantText: 'Resposta do NOX.' });
    await app.close();
  });

  it('serves the push-to-talk client without exposing the protected API', async () => {
    const app = voiceApp();
    const page = await app.inject({ method: 'GET', url: '/voice' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('NOX VOICE');
    expect(page.body).not.toContain(env.NOX_API_TOKEN);
    expect(page.headers['permissions-policy']).toBe('microphone=(self)');
    await app.close();
  });
});

describe('Voice providers and formats', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps the OpenRouter transcription and speech endpoints to independent contracts', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    let call = 0;
    const mockFetch: typeof fetch = async (input, init) => {
      requests.push({
        url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
        body:
          init?.body && typeof init.body === 'string'
            ? (JSON.parse(init.body) as unknown)
            : undefined,
      });
      call++;
      if (call === 1)
        return new Response(
          JSON.stringify({
            text: 'Transcrição realista',
            usage: {
              seconds: 2.5,
              input_tokens: 10,
              output_tokens: 4,
              total_tokens: 14,
              cost: 0.0002,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-generation-id': 'stt-1' },
          },
        );
      return new Response(Uint8Array.of(0x49, 0x44, 0x33).buffer, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'tts-1' },
      });
    };
    vi.stubGlobal('fetch', mockFetch);
    const options = { apiKey: 'test', baseUrl: 'https://openrouter.example/api/v1' };
    const stt = new OpenRouterSpeechToTextProvider(options);
    const tts = new OpenRouterTextToSpeechProvider(options);
    const transcription = await stt.transcribe({
      audio: validWav(),
      format: 'wav',
      mimeType: 'audio/wav',
      model: 'stt-model',
      language: 'pt',
    });
    const synthesis = await tts.synthesize({
      text: 'Olá',
      model: 'tts-model',
      voice: 'alloy',
      format: 'mp3',
    });

    expect(transcription).toMatchObject({
      text: 'Transcrição realista',
      generationId: 'stt-1',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, inputUnits: '2.5' },
    });
    expect(synthesis).toMatchObject({ mimeType: 'audio/mpeg', generationId: 'tts-1' });
    expect(requests[0]).toMatchObject({
      url: 'https://openrouter.example/api/v1/audio/transcriptions',
      body: { model: 'stt-model', input_audio: { format: 'wav' }, language: 'pt' },
    });
    expect(requests[1]).toEqual({
      url: 'https://openrouter.example/api/v1/audio/speech',
      body: { model: 'tts-model', input: 'Olá', voice: 'alloy', response_format: 'mp3' },
    });
  });

  it('accepts only declared browser/file formats with matching signatures', () => {
    const webm = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0);
    const mp3 = Uint8Array.of(0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const m4a = Uint8Array.of(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0);
    expect(validateVoiceAudio(webm, 'audio/webm;codecs=opus').format).toBe('webm');
    expect(validateVoiceAudio(mp3, 'audio/mpeg').format).toBe('mp3');
    expect(validateVoiceAudio(m4a, 'audio/mp4').format).toBe('m4a');
  });
});

function voiceApp(
  options: {
    env?: typeof env;
    provider?: AIProvider;
    stt?: SpeechToTextProvider;
    tts?: TextToSpeechProvider;
    usage?: AIUsageRepository;
  } = {},
) {
  return buildApp(options.env ?? env, {
    provider:
      options.provider ??
      new QueueProvider([{ message: { role: 'assistant', content: 'Resposta do NOX.' } }]),
    stt: options.stt ?? new MockStt(),
    tts: options.tts ?? new MockTts(),
    ...(options.usage ? { usage: options.usage } : {}),
  });
}

function validWav(size = 44): Buffer {
  const audio = Buffer.alloc(size);
  audio.write('RIFF', 0, 'ascii');
  audio.write('WAVE', 8, 'ascii');
  return audio;
}

function multipartAudio(audio: Buffer, mimeType: string, conversationId?: string) {
  const boundary = '----nox-voice-test-boundary';
  const chunks: Buffer[] = [];
  if (conversationId) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="conversationId"\r\n\r\n${conversationId}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.bin"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}
