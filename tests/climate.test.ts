import type { AIProvider, ChatRequest } from '@nox/ai';
import { InMemoryAuditRepository } from '@nox/audit';
import {
  BridgeClimateProvider,
  InMemoryDeviceCommandBroker,
  MockClimateProvider,
  bridgeResultSchema,
  createClimateTools,
} from '@nox/climate';
import { loadEnv } from '@nox/shared';
import { buildApp } from '../apps/api/src/app.js';

describe('ClimateProvider', () => {
  it('supports state, power, temperature and mode with the mock adapter', async () => {
    const provider = new MockClimateProvider({ power: false });
    expect(await provider.execute('ac', { action: 'get_state' })).toMatchObject({
      success: true,
      confirmed: true,
      state: { power: false },
    });
    expect(await provider.execute('ac', { action: 'turn_on' })).toMatchObject({
      state: { power: true },
    });
    expect(
      await provider.execute('ac', { action: 'set_temperature', temperatureCelsius: 23 }),
    ).toMatchObject({ state: { power: true, targetTemperatureCelsius: 23 } });
    expect(await provider.execute('ac', { action: 'set_mode', mode: 'heat' })).toMatchObject({
      state: { mode: 'heat' },
    });
    expect(await provider.execute('ac', { action: 'turn_off' })).toMatchObject({
      state: { power: false },
    });
    provider.setOnline(false);
    expect(await provider.execute('ac', { action: 'get_state' })).toMatchObject({
      success: false,
      confirmed: false,
      code: 'DEVICE_OFFLINE',
    });
  });

  it('round-trips a command through the outbound bridge broker', async () => {
    const broker = new InMemoryDeviceCommandBroker(1_000);
    const provider = new BridgeClimateProvider(broker, 'home');
    const execution = provider.execute('home-ac', {
      action: 'set_temperature',
      temperatureCelsius: 23,
    });
    const command = await broker.poll('home', 100);
    expect(command).toMatchObject({
      bridgeId: 'home',
      deviceId: 'home-ac',
      operation: { action: 'set_temperature', temperatureCelsius: 23 },
    });
    expect(
      broker.complete('home', {
        commandId: command!.id,
        success: true,
        confirmed: true,
        state: {
          power: true,
          targetTemperatureCelsius: 23,
          mode: 'cool',
          online: true,
        },
      }),
    ).toBe(true);
    await expect(execution).resolves.toMatchObject({
      success: true,
      confirmed: true,
      source: 'bridge',
      bridgeId: 'home',
      state: { targetTemperatureCelsius: 23 },
    });
    broker.close();
  });

  it('treats timeout and unconfirmed bridge responses as failures', async () => {
    vi.useFakeTimers();
    const broker = new InMemoryDeviceCommandBroker(25);
    const provider = new BridgeClimateProvider(broker, 'home');
    const timedOut = provider.execute('home-ac', { action: 'get_state' });
    await vi.advanceTimersByTimeAsync(30);
    await expect(timedOut).resolves.toMatchObject({
      success: false,
      confirmed: false,
      code: 'BRIDGE_OFFLINE',
    });
    vi.useRealTimers();

    const secondBroker = new InMemoryDeviceCommandBroker(1_000);
    const secondProvider = new BridgeClimateProvider(secondBroker, 'home');
    const execution = secondProvider.execute('home-ac', { action: 'turn_on' });
    const command = await secondBroker.poll('home', 100);
    secondBroker.complete('home', {
      commandId: command!.id,
      success: false,
      confirmed: false,
      code: 'STATE_NOT_CONFIRMED',
      error: 'readback mismatch',
    });
    await expect(execution).resolves.toMatchObject({
      success: false,
      confirmed: false,
      code: 'STATE_NOT_CONFIRMED',
    });
    secondBroker.close();
  });

  it('independently rejects a bridge success whose state does not match the command', async () => {
    const broker = new InMemoryDeviceCommandBroker(1_000);
    const provider = new BridgeClimateProvider(broker, 'home');
    const execution = provider.execute('home-ac', {
      action: 'set_temperature',
      temperatureCelsius: 23,
    });
    const command = await broker.poll('home', 100);
    broker.complete('home', {
      commandId: command!.id,
      success: true,
      confirmed: true,
      state: { power: true, targetTemperatureCelsius: 24, mode: 'cool', online: true },
    });
    await expect(execution).resolves.toMatchObject({
      success: false,
      confirmed: false,
      code: 'STATE_NOT_CONFIRMED',
      state: { targetTemperatureCelsius: 24 },
    });
    broker.close();
  });

  it('rejects false-success and invalid bridge payloads', () => {
    expect(
      bridgeResultSchema.safeParse({
        commandId: '11111111-1111-4111-8111-111111111111',
        success: true,
        confirmed: false,
      }).success,
    ).toBe(false);
    expect(
      bridgeResultSchema.safeParse({
        commandId: '11111111-1111-4111-8111-111111111111',
        success: false,
        confirmed: false,
      }).success,
    ).toBe(false);
  });

  it('marks reads as READ and every mutation as ACTION', () => {
    const tools = createClimateTools(new MockClimateProvider(), 'home-ac');
    expect(Object.fromEntries(tools.map((tool) => [tool.name, tool.permission]))).toEqual({
      'climate.get_state': 'READ',
      'climate.turn_on': 'ACTION',
      'climate.turn_off': 'ACTION',
      'climate.set_temperature': 'ACTION',
      'climate.set_mode': 'ACTION',
    });
  });

  it('presents provider failures without claiming a physical success', async () => {
    const provider = new MockClimateProvider();
    provider.setOnline(false);
    const tool = createClimateTools(provider, 'home-ac').find(
      (candidate) => candidate.name === 'climate.set_temperature',
    );
    expect(tool).toBeDefined();
    const result = await tool!.execute(
      { temperatureCelsius: 23 },
      {
        userId: 'owner',
        deviceId: 'client',
        sessionId: '11111111-1111-4111-8111-111111111111',
        requestId: '22222222-2222-4222-8222-222222222222',
        signal: AbortSignal.timeout(1_000),
      },
    );
    expect(result).toMatchObject({ success: false, code: 'DEVICE_OFFLINE' });
    const spoken = tool!.presentResult?.(result, 'voice');
    expect(spoken).toBe('Não consegui ajustar o ar-condicionado.');
    expect(spoken).not.toContain('Pronto');
  });
});

describe('Core to bridge integration', () => {
  const bridgeToken = 'bridge-token-with-at-least-32-characters';
  const env = loadEnv({
    NODE_ENV: 'test',
    OPENROUTER_API_KEY: 'test',
    OPENROUTER_MODEL: 'test-chat',
    MODEL_FAST: 'test-fast',
    MODEL_STT: 'test-stt',
    MODEL_TTS: 'test-tts',
    OPENROUTER_BASE_URL: 'https://example.com',
    NOX_API_TOKEN: 'test-token-with-at-least-32-characters',
    CLIMATE_DRIVER: 'bridge',
    NOX_DEVICE_BRIDGE_TOKEN: bridgeToken,
    DEVICE_BRIDGE_COMMAND_TIMEOUT_MS: '1000',
    DEVICE_BRIDGE_LONG_POLL_MS: '1000',
  });
  const userHeaders = { authorization: `Bearer ${env.NOX_API_TOKEN}` };
  const bridgeHeaders = { authorization: `Bearer ${bridgeToken}` };

  it('requires confirmation, authenticates the bridge, confirms readback and audits it', async () => {
    const requests: ChatRequest[] = [];
    const provider: AIProvider = {
      async chat(request) {
        requests.push(request);
        return {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'climate-action',
                name: 'climate.set_temperature',
                arguments: { temperatureCelsius: 23 },
              },
            ],
          },
        };
      },
      async *stream() {
        yield '';
      },
    };
    const audit = new InMemoryAuditRepository();
    const app = buildApp(env, { provider, audit });
    const pendingResponse = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: userHeaders,
      payload: { message: 'Coloque o ar em 23 graus.' },
    });
    const pending = pendingResponse.json<{ confirmationId: string }>();
    expect(pendingResponse.statusCode).toBe(200);
    expect(pending).toHaveProperty('confirmationId');
    expect(requests).toHaveLength(1);

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/bridge/v1/bridges/home/commands/next',
    });
    expect(unauthorized.statusCode).toBe(401);

    const nextCommand = app.inject({
      method: 'GET',
      url: '/bridge/v1/bridges/home/commands/next',
      headers: bridgeHeaders,
    });
    const confirmation = app.inject({
      method: 'POST',
      url: `/v1/confirmations/${pending.confirmationId}`,
      headers: userHeaders,
      payload: { approved: true },
    });
    const commandResponse = await nextCommand;
    const command = commandResponse.json<{ id: string }>();
    expect(commandResponse.statusCode).toBe(200);

    const submitted = await app.inject({
      method: 'POST',
      url: `/bridge/v1/bridges/home/commands/${command.id}/result`,
      headers: bridgeHeaders,
      payload: {
        commandId: command.id,
        success: true,
        confirmed: true,
        state: {
          power: true,
          targetTemperatureCelsius: 23,
          mode: 'cool',
          online: true,
        },
      },
    });
    expect(submitted.statusCode).toBe(202);
    const completed = await confirmation;
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ content: 'Pronto, 23 graus.' });
    expect(requests).toHaveLength(1);
    const toolResult = audit.events.find((event) => event.type === 'tool_result');
    expect(JSON.stringify(toolResult?.data)).toContain('"bridgeId":"home"');
    expect(JSON.stringify(toolResult?.data)).toContain('"confirmed":true');
    await app.close();
  });
});
