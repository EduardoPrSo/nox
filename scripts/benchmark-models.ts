import 'dotenv/config';
import { z } from 'zod';
import { systemPromptFor } from '@nox/agent';
import { OpenRouterProvider, type AIMessage, type AITool, type ChatResponse } from '@nox/ai';
import { createClimateTools, MockClimateProvider } from '@nox/climate';
import { loadEnv } from '@nox/shared';
import { createMockTools } from '@nox/tools';

const DEFAULT_MODELS = ['openai/gpt-5.6-luna', 'openai/gpt-5.4-nano', 'openai/gpt-4.1-mini'];

type Scenario = {
  name: string;
  prompt: string;
  expectedTool?: string;
  argumentsAreValid?: (argumentsValue: unknown) => boolean;
  toolResult?: unknown;
  responseIsUseful: (content: string) => boolean;
};

type RunResult = {
  model: string;
  scenario: string;
  latencyMs: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolExpected: boolean;
  toolCorrect: boolean;
  responseUseful: boolean;
  voiceStyle: boolean;
  response: string;
  error?: string;
};

const scenarios: Scenario[] = [
  {
    name: 'simple-answer',
    prompt: 'Qual é a capital do Brasil?',
    responseIsUseful: (content) => /bras[ií]lia/i.test(content),
  },
  {
    name: 'climate-state',
    prompt: 'Como está o ar-condicionado?',
    expectedTool: 'climate.get_state',
    argumentsAreValid: (value) => isRecord(value) && Object.keys(value).length === 0,
    toolResult: {
      success: true,
      data: { isOn: true, temperature: 23, mode: 'cool', mock: true },
    },
    responseIsUseful: (content) => /23/.test(content) && /ligad/i.test(content),
  },
  {
    name: 'climate-action',
    prompt: 'Coloque o ar-condicionado em 23 graus.',
    expectedTool: 'climate.set_temperature',
    argumentsAreValid: (value) => isRecord(value) && value.temperatureCelsius === 23,
    toolResult: {
      success: true,
      data: { isOn: true, temperature: 23, mode: 'cool', mock: true },
    },
    responseIsUseful: (content) => /23/.test(content) && !/n[aã]o (foi|consegui)/i.test(content),
  },
];

const env = loadEnv();
const models = unique(
  (process.env.MODEL_BENCHMARK_MODELS ?? DEFAULT_MODELS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const samples = positiveInteger(process.env.MODEL_BENCHMARK_SAMPLES, 3);
await assertModelsExist(models, env.OPENROUTER_BASE_URL);

const provider = new OpenRouterProvider({
  apiKey: env.OPENROUTER_API_KEY,
  baseUrl: env.OPENROUTER_BASE_URL,
  appName: `${env.OPENROUTER_APP_NAME} model benchmark`,
  ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
  timeoutMs: 60_000,
});
const tools = benchmarkTools();
const runs: RunResult[] = [];

for (const model of models) {
  for (let sample = 0; sample < samples; sample++) {
    for (const scenario of scenarios) {
      runs.push(await runScenario(model, scenario, tools));
    }
  }
}

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      samplesPerScenario: samples,
      scenarios: scenarios.map(({ name }) => name),
      results: models.map((model) =>
        summarize(
          model,
          runs.filter((run) => run.model === model),
        ),
      ),
      runs,
    },
    null,
    2,
  ),
);

async function runScenario(model: string, scenario: Scenario, tools: AITool[]): Promise<RunResult> {
  const started = performance.now();
  let providerCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  try {
    const messages: AIMessage[] = [
      { role: 'system', content: systemPromptFor('voice') },
      { role: 'user', content: scenario.prompt },
    ];
    const reasoningEffort = model.startsWith('openai/gpt-5') ? ('none' as const) : undefined;
    const first = await provider.chat({
      model,
      messages,
      tools,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
    providerCalls++;
    ({ inputTokens, outputTokens, costUsd } = addUsage(
      { inputTokens, outputTokens, costUsd },
      first,
    ));
    const calls = first.message.toolCalls ?? [];
    const expectedCall = calls.find((call) => call.name === scenario.expectedTool);
    const toolCorrect = scenario.expectedTool
      ? calls.length === 1 &&
        Boolean(expectedCall) &&
        (scenario.argumentsAreValid?.(expectedCall?.arguments) ?? true)
      : calls.length === 0;
    let response = textContent(first);
    if (scenario.expectedTool && toolCorrect && expectedCall) {
      const followUp = await provider.chat({
        model,
        messages: [
          ...messages,
          first.message,
          {
            role: 'tool',
            toolCallId: expectedCall.id,
            content: JSON.stringify(scenario.toolResult),
          },
        ],
        tools,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      });
      providerCalls++;
      ({ inputTokens, outputTokens, costUsd } = addUsage(
        { inputTokens, outputTokens, costUsd },
        followUp,
      ));
      response = textContent(followUp);
    }
    return {
      model,
      scenario: scenario.name,
      latencyMs: Math.round(performance.now() - started),
      providerCalls,
      inputTokens,
      outputTokens,
      costUsd,
      toolExpected: Boolean(scenario.expectedTool),
      toolCorrect,
      responseUseful: scenario.responseIsUseful(response),
      voiceStyle: followsVoiceStyle(response),
      response,
    };
  } catch (error) {
    return {
      model,
      scenario: scenario.name,
      latencyMs: Math.round(performance.now() - started),
      providerCalls,
      inputTokens,
      outputTokens,
      costUsd,
      toolExpected: Boolean(scenario.expectedTool),
      toolCorrect: false,
      responseUseful: false,
      voiceStyle: false,
      response: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function benchmarkTools(): AITool[] {
  return [
    ...createMockTools(),
    ...createClimateTools(new MockClimateProvider(), 'benchmark-ac'),
  ].map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema, { target: 'draft-7' }),
  }));
}

function followsVoiceStyle(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || [...trimmed].length > 240 || /\n|^\s*[-*#]|```/.test(trimmed)) return false;
  if (/^(claro|certamente|com certeza)[,!.]/i.test(trimmed)) return false;
  const sentences = trimmed.split(/[.!?]+(?:\s|$)/).filter((value) => value.trim()).length;
  return sentences >= 1 && sentences <= 2;
}

function textContent(response: ChatResponse): string {
  return typeof response.message.content === 'string' ? response.message.content.trim() : '';
}

function addUsage(
  current: { inputTokens: number; outputTokens: number; costUsd: number },
  response: ChatResponse,
) {
  return {
    inputTokens: current.inputTokens + (response.usage?.inputTokens ?? 0),
    outputTokens: current.outputTokens + (response.usage?.outputTokens ?? 0),
    costUsd: current.costUsd + Number(response.usage?.cost ?? 0),
  };
}

function summarize(model: string, modelRuns: RunResult[]) {
  const latencies = modelRuns.map((run) => run.latencyMs).sort((a, b) => a - b);
  const toolRuns = modelRuns.filter((run) => run.toolExpected);
  const totalCost = sum(modelRuns.map((run) => run.costUsd));
  return {
    model,
    scenarioRuns: modelRuns.length,
    providerCalls: sum(modelRuns.map((run) => run.providerCalls)),
    errors: modelRuns.filter((run) => run.error).length,
    latencyMs: {
      average: Math.round(average(latencies)),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    },
    toolCallingReliability: ratio(
      toolRuns.filter((run) => run.toolCorrect).length,
      toolRuns.length,
    ),
    usefulResponseRate: ratio(
      modelRuns.filter((run) => run.responseUseful).length,
      modelRuns.length,
    ),
    voiceStyleRate: ratio(modelRuns.filter((run) => run.voiceStyle).length, modelRuns.length),
    inputTokens: sum(modelRuns.map((run) => run.inputTokens)),
    outputTokens: sum(modelRuns.map((run) => run.outputTokens)),
    costUsd: Number(totalCost.toFixed(8)),
    averageCostUsdPerScenario: Number((totalCost / modelRuns.length).toFixed(8)),
  };
}

async function assertModelsExist(modelsToCheck: string[], baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`);
  if (!response.ok) throw new Error(`Could not read OpenRouter model catalog (${response.status})`);
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  const available = new Set(payload.data?.map((model) => model.id).filter(Boolean));
  const missing = modelsToCheck.filter((model) => !available.has(model));
  if (missing.length) throw new Error(`Unknown OpenRouter model slug(s): ${missing.join(', ')}`);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20)
    throw new Error('MODEL_BENCHMARK_SAMPLES must be an integer between 1 and 20');
  return parsed;
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  return sortedValues[Math.ceil(sortedValues.length * fraction) - 1] ?? 0;
}

function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(value: number, total: number): number {
  return total ? Number((value / total).toFixed(4)) : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
