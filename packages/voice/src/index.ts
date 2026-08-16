import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { AgentResponse, AgentRuntime } from '@nox/agent';
import type { ModelRouter } from '@nox/ai';
import type { IdentityContext } from '@nox/identity';
import type { AIUsageRepository, NewAIUsageRecord } from '@nox/usage';

export const VOICE_INPUT_FORMATS = ['wav', 'webm', 'mp3', 'm4a'] as const;
export type VoiceInputFormat = (typeof VOICE_INPUT_FORMATS)[number];
export type VoiceOutputFormat = 'mp3' | 'pcm';

export type SpeechUsage = {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputUnits?: string;
  outputUnits?: string;
  unit?: string;
  latencyMs: number;
  cost?: string;
};

export type TranscriptionRequest = {
  audio: Uint8Array;
  format: VoiceInputFormat;
  mimeType: string;
  model: string;
  language?: string;
  signal?: AbortSignal;
};

export type TranscriptionResult = {
  text: string;
  usage: SpeechUsage;
  generationId?: string;
};

export interface SpeechToTextProvider {
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export type SpeechSynthesisRequest = {
  text: string;
  model: string;
  voice: string;
  format: VoiceOutputFormat;
  signal?: AbortSignal;
};

export type SpeechSynthesisResult = {
  audio: Uint8Array;
  mimeType: string;
  usage: SpeechUsage;
  generationId?: string;
};

export interface TextToSpeechProvider {
  synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;
}

type OpenRouterSpeechOptions = {
  apiKey: string;
  baseUrl?: string;
  siteUrl?: string;
  appName?: string;
  timeoutMs?: number;
};

type TranscriptionPayload = {
  text?: string;
  usage?: {
    seconds?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost?: number | string;
  };
  error?: { message?: string };
};

export class SpeechProviderError extends Error {
  constructor(
    readonly stage: 'STT' | 'TTS',
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'SpeechProviderError';
  }
}

export class OpenRouterSpeechToTextProvider implements SpeechToTextProvider {
  constructor(private readonly options: OpenRouterSpeechOptions) {}

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const started = performance.now();
    const response = await fetch(`${baseUrl(this.options)}/audio/transcriptions`, {
      method: 'POST',
      headers: headers(this.options),
      signal: combinedSignal(request.signal, this.options.timeoutMs ?? 60_000),
      body: JSON.stringify({
        model: request.model,
        input_audio: {
          data: Buffer.from(request.audio).toString('base64'),
          format: request.format,
        },
        ...(request.language ? { language: request.language } : {}),
      }),
    });
    const payload = (await readJson(response)) as TranscriptionPayload;
    if (!response.ok) {
      throw new SpeechProviderError(
        'STT',
        response.status,
        payload.error?.message ?? `OpenRouter STT error ${response.status}`,
      );
    }
    const text = payload.text?.trim();
    if (!text) throw new SpeechProviderError('STT', response.status, 'STT returned no text');
    const usage: SpeechUsage = {
      provider: 'openrouter',
      model: request.model,
      latencyMs: Math.round(performance.now() - started),
    };
    if (payload.usage?.input_tokens !== undefined) usage.inputTokens = payload.usage.input_tokens;
    if (payload.usage?.output_tokens !== undefined)
      usage.outputTokens = payload.usage.output_tokens;
    if (payload.usage?.total_tokens !== undefined) usage.totalTokens = payload.usage.total_tokens;
    if (payload.usage?.seconds !== undefined) {
      usage.inputUnits = String(payload.usage.seconds);
      usage.unit = 'seconds';
    }
    const cost = decimalString(payload.usage?.cost);
    if (cost !== undefined) usage.cost = cost;
    const generationId = response.headers.get('x-generation-id') ?? undefined;
    return { text, usage, ...(generationId ? { generationId } : {}) };
  }
}

export class OpenRouterTextToSpeechProvider implements TextToSpeechProvider {
  constructor(private readonly options: OpenRouterSpeechOptions) {}

  async synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
    const started = performance.now();
    const response = await fetch(`${baseUrl(this.options)}/audio/speech`, {
      method: 'POST',
      headers: headers(this.options),
      signal: combinedSignal(request.signal, this.options.timeoutMs ?? 60_000),
      body: JSON.stringify({
        model: request.model,
        input: request.text,
        voice: request.voice,
        response_format: request.format,
      }),
    });
    if (!response.ok) {
      const payload = (await readJson(response)) as { error?: { message?: string } };
      throw new SpeechProviderError(
        'TTS',
        response.status,
        payload.error?.message ?? `OpenRouter TTS error ${response.status}`,
      );
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0)
      throw new SpeechProviderError('TTS', response.status, 'TTS returned no audio');
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (!mimeType?.startsWith('audio/'))
      throw new SpeechProviderError('TTS', response.status, 'TTS returned a non-audio response');
    const usage: SpeechUsage = {
      provider: 'openrouter',
      model: request.model,
      inputUnits: String([...request.text].length),
      unit: 'characters',
      latencyMs: Math.round(performance.now() - started),
    };
    const generationId = response.headers.get('x-generation-id') ?? undefined;
    return { audio, mimeType, usage, ...(generationId ? { generationId } : {}) };
  }
}

export type ValidatedAudio = {
  audio: Uint8Array;
  mimeType: string;
  format: VoiceInputFormat;
};

export class InvalidVoiceAudioError extends Error {
  constructor(readonly code: 'UNSUPPORTED_AUDIO_TYPE' | 'INVALID_AUDIO') {
    super(code);
    this.name = 'InvalidVoiceAudioError';
  }
}

export function validateVoiceAudio(audio: Uint8Array, declaredMimeType: string): ValidatedAudio {
  const mimeType = declaredMimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  const format = formatForMimeType(mimeType);
  if (!format) throw new InvalidVoiceAudioError('UNSUPPORTED_AUDIO_TYPE');
  if (audio.byteLength < 12 || !hasExpectedSignature(audio, format))
    throw new InvalidVoiceAudioError('INVALID_AUDIO');
  return { audio, mimeType: canonicalMimeType(format), format };
}

export type VoiceResponse = {
  type: AgentResponse['type'];
  transcription: string;
  assistantText: string;
  conversationId: string;
  requestId: string;
  audio: { mimeType: string; data: string };
  audioTextTruncated: boolean;
  latencyMs: { stt: number; agent: number; tts: number; total: number };
  confirmationId?: string;
  description?: string;
  expiresAt?: string;
};

export type VoicePartialResponse = Omit<VoiceResponse, 'audio' | 'latencyMs'> & {
  audio: null;
  latencyMs: { stt: number; agent: number; tts: number; total: number };
};

export class VoiceStageError extends Error {
  constructor(
    readonly stage: 'STT' | 'TTS',
    readonly partial?: VoicePartialResponse,
    options?: ErrorOptions,
  ) {
    super(`${stage}_FAILED`, options);
    this.name = 'VoiceStageError';
  }
}

export class EmptyTranscriptionError extends Error {
  constructor() {
    super('EMPTY_TRANSCRIPTION');
    this.name = 'EmptyTranscriptionError';
  }
}

export class VoiceService {
  constructor(
    private readonly dependencies: {
      runtime: AgentRuntime;
      stt: SpeechToTextProvider;
      tts: TextToSpeechProvider;
      router: ModelRouter;
      usage: AIUsageRepository;
      language: string;
      voice: string;
      outputFormat?: VoiceOutputFormat;
      maxTtsCharacters?: number;
      onTelemetryError?: (error: unknown) => void;
    },
  ) {}

  async run(
    input: IdentityContext & ValidatedAudio & { conversationId?: string },
  ): Promise<VoiceResponse> {
    const totalStarted = performance.now();
    const requestId = randomUUID();
    const sttRoute = this.dependencies.router.resolve('STT');
    const ttsRoute = this.dependencies.router.resolve('TTS');
    const sttStarted = performance.now();
    let transcription: TranscriptionResult;
    try {
      transcription = await this.dependencies.stt.transcribe({
        audio: input.audio,
        format: input.format,
        mimeType: input.mimeType,
        model: sttRoute.model,
        language: this.dependencies.language,
      });
    } catch (error) {
      throw new VoiceStageError('STT', undefined, { cause: error });
    }
    const sttLatency = Math.round(performance.now() - sttStarted);
    if (!transcription.text.trim()) throw new EmptyTranscriptionError();

    const agentStarted = performance.now();
    const agentResponse = await this.dependencies.runtime.run({
      userId: input.userId,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      requestId,
      message: transcription.text,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    });
    const agentLatency = Math.round(performance.now() - agentStarted);
    await this.recordUsage(
      usageRecord(transcription.usage, 'STT', requestId, input, agentResponse.conversationId),
    );

    const assistantText = textForAgentResponse(agentResponse);
    const maxTtsCharacters = this.dependencies.maxTtsCharacters ?? 4_000;
    const assistantCharacters = [...assistantText];
    const synthesisText = assistantCharacters.slice(0, maxTtsCharacters).join('');
    const audioTextTruncated = assistantCharacters.length > maxTtsCharacters;
    const ttsStarted = performance.now();
    let synthesis: SpeechSynthesisResult;
    try {
      synthesis = await this.dependencies.tts.synthesize({
        text: synthesisText,
        model: ttsRoute.model,
        voice: this.dependencies.voice,
        format: this.dependencies.outputFormat ?? 'mp3',
      });
    } catch (error) {
      const ttsLatency = Math.round(performance.now() - ttsStarted);
      throw new VoiceStageError(
        'TTS',
        {
          ...baseResponse(agentResponse, transcription.text, assistantText),
          audio: null,
          audioTextTruncated,
          latencyMs: {
            stt: sttLatency,
            agent: agentLatency,
            tts: ttsLatency,
            total: Math.round(performance.now() - totalStarted),
          },
        },
        { cause: error },
      );
    }
    const ttsLatency = Math.round(performance.now() - ttsStarted);
    await this.recordUsage(
      usageRecord(synthesis.usage, 'TTS', requestId, input, agentResponse.conversationId),
    );
    return {
      ...baseResponse(agentResponse, transcription.text, assistantText),
      audio: {
        mimeType: synthesis.mimeType,
        data: Buffer.from(synthesis.audio).toString('base64'),
      },
      audioTextTruncated,
      latencyMs: {
        stt: sttLatency,
        agent: agentLatency,
        tts: ttsLatency,
        total: Math.round(performance.now() - totalStarted),
      },
    };
  }

  private async recordUsage(record: NewAIUsageRecord): Promise<void> {
    try {
      await this.dependencies.usage.record(record);
    } catch (error) {
      try {
        this.dependencies.onTelemetryError?.(error);
      } catch {
        // Telemetry and its error reporting are both best-effort.
      }
    }
  }
}

function headers(options: OpenRouterSpeechOptions): Record<string, string> {
  const result: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (options.siteUrl) result['HTTP-Referer'] = options.siteUrl;
  if (options.appName) result['X-Title'] = options.appName;
  return result;
}

function baseUrl(options: OpenRouterSpeechOptions): string {
  return (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function decimalString(value: number | string | undefined): string | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? String(value) : undefined;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) return value;
  return undefined;
}

function formatForMimeType(mimeType: string): VoiceInputFormat | undefined {
  switch (mimeType) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/webm':
      return 'webm';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    default:
      return undefined;
  }
}

function canonicalMimeType(format: VoiceInputFormat): string {
  switch (format) {
    case 'wav':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
  }
}

function hasExpectedSignature(audio: Uint8Array, format: VoiceInputFormat): boolean {
  switch (format) {
    case 'wav':
      return equalsAscii(audio, 0, 'RIFF') && equalsAscii(audio, 8, 'WAVE');
    case 'webm':
      return equalBytes(audio.subarray(0, 4), Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3));
    case 'mp3':
      return (
        equalsAscii(audio, 0, 'ID3') ||
        (audio[0] === 0xff && audio[1] !== undefined && (audio[1] & 0xe0) === 0xe0)
      );
    case 'm4a':
      return equalsAscii(audio, 4, 'ftyp');
  }
}

function equalsAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  return equalBytes(bytes.subarray(offset, offset + value.length), Buffer.from(value, 'ascii'));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function textForAgentResponse(response: AgentResponse): string {
  return response.type === 'message'
    ? response.content
    : `Preciso da sua confirmação para: ${response.description}`;
}

function baseResponse(
  response: AgentResponse,
  transcription: string,
  assistantText: string,
): Omit<VoiceResponse, 'audio' | 'audioTextTruncated' | 'latencyMs'> {
  return {
    type: response.type,
    transcription,
    assistantText,
    conversationId: response.conversationId,
    requestId: response.requestId,
    ...(response.type === 'confirmation_required'
      ? {
          confirmationId: response.confirmationId,
          description: response.description,
          expiresAt: response.expiresAt,
        }
      : {}),
  };
}

function usageRecord(
  usage: SpeechUsage,
  capability: 'STT' | 'TTS',
  requestId: string,
  identity: IdentityContext,
  conversationId: string,
): NewAIUsageRecord {
  return {
    requestId,
    userId: identity.userId,
    deviceId: identity.deviceId,
    sessionId: identity.sessionId,
    conversationId,
    provider: usage.provider,
    model: usage.model,
    capability,
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.inputUnits !== undefined ? { inputUnits: usage.inputUnits } : {}),
    ...(usage.outputUnits !== undefined ? { outputUnits: usage.outputUnits } : {}),
    ...(usage.unit !== undefined ? { unit: usage.unit } : {}),
    latencyMs: usage.latencyMs,
    ...(usage.cost !== undefined ? { estimatedCost: usage.cost } : {}),
  };
}
