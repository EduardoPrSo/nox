import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolDefinition, ToolResult } from '@nox/tools';

export const CLIMATE_MODES = ['auto', 'cool', 'dry', 'heat', 'fan'] as const;
export type ClimateMode = (typeof CLIMATE_MODES)[number];

export type ClimateState = {
  power: boolean;
  targetTemperatureCelsius: number;
  mode: ClimateMode;
  online: boolean;
  indoorTemperatureCelsius?: number;
  outdoorTemperatureCelsius?: number;
};

export type ClimateOperation =
  | { action: 'get_state' }
  | { action: 'turn_on' }
  | { action: 'turn_off' }
  | { action: 'set_temperature'; temperatureCelsius: number }
  | { action: 'set_mode'; mode: ClimateMode };

export type ClimateSuccess = {
  success: true;
  confirmed: true;
  deviceId: string;
  source: 'mock' | 'bridge';
  state: ClimateState;
  bridgeId?: string;
  commandId?: string;
};
export type ClimateFailure = {
  success: false;
  confirmed: false;
  deviceId: string;
  source: 'mock' | 'bridge';
  code:
    | 'BRIDGE_OFFLINE'
    | 'DEVICE_OFFLINE'
    | 'TIMEOUT'
    | 'AUTHENTICATION_FAILED'
    | 'COMMAND_REJECTED'
    | 'INVALID_RESPONSE'
    | 'STATE_NOT_CONFIRMED'
    | 'UNKNOWN';
  error: string;
  bridgeId?: string;
  commandId?: string;
  state?: ClimateState;
};
export type ClimateResult = ClimateSuccess | ClimateFailure;

export interface ClimateProvider {
  execute(
    deviceId: string,
    operation: ClimateOperation,
    signal?: AbortSignal,
  ): Promise<ClimateResult>;
}

export class MockClimateProvider implements ClimateProvider {
  private state: ClimateState;

  constructor(initialState: Partial<ClimateState> = {}) {
    this.state = {
      power: true,
      targetTemperatureCelsius: 24,
      mode: 'cool',
      online: true,
      ...initialState,
    };
  }

  setOnline(online: boolean): void {
    this.state.online = online;
  }

  async execute(deviceId: string, operation: ClimateOperation): Promise<ClimateResult> {
    if (!this.state.online)
      return failure('mock', deviceId, 'DEVICE_OFFLINE', 'O ar-condicionado está offline.');
    switch (operation.action) {
      case 'get_state':
        break;
      case 'turn_on':
        this.state.power = true;
        break;
      case 'turn_off':
        this.state.power = false;
        break;
      case 'set_temperature':
        this.state.power = true;
        this.state.targetTemperatureCelsius = operation.temperatureCelsius;
        break;
      case 'set_mode':
        this.state.power = true;
        this.state.mode = operation.mode;
        break;
    }
    return {
      success: true,
      confirmed: true,
      deviceId,
      source: 'mock',
      state: { ...this.state },
    };
  }
}

export type BridgeCommand = {
  id: string;
  bridgeId: string;
  deviceId: string;
  operation: ClimateOperation;
  createdAt: string;
  expiresAt: string;
};

export type BridgeCommandResult = {
  commandId: string;
  success: boolean;
  confirmed: boolean;
  state?: ClimateState;
  code?: ClimateFailure['code'];
  error?: string;
};

type PendingCommand = {
  command: BridgeCommand;
  resolve: (result: BridgeCommandResult) => void;
  timeout: NodeJS.Timeout;
};

export interface DeviceCommandBroker {
  dispatch(
    bridgeId: string,
    deviceId: string,
    operation: ClimateOperation,
    signal?: AbortSignal,
  ): Promise<BridgeCommandResult>;
  poll(bridgeId: string, waitMs: number, signal?: AbortSignal): Promise<BridgeCommand | undefined>;
  complete(bridgeId: string, result: BridgeCommandResult): boolean;
  close(): void;
}

export class InMemoryDeviceCommandBroker implements DeviceCommandBroker {
  private readonly queues = new Map<string, BridgeCommand[]>();
  private readonly pollers = new Map<string, Set<(command?: BridgeCommand) => void>>();
  private readonly pending = new Map<string, PendingCommand>();

  constructor(private readonly commandTimeoutMs = 30_000) {}

  async dispatch(
    bridgeId: string,
    deviceId: string,
    operation: ClimateOperation,
    signal?: AbortSignal,
  ): Promise<BridgeCommandResult> {
    const id = randomUUID();
    const now = Date.now();
    const command: BridgeCommand = {
      id,
      bridgeId,
      deviceId,
      operation,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.commandTimeoutMs).toISOString(),
    };
    return new Promise<BridgeCommandResult>((resolve) => {
      const finish = (result: BridgeCommandResult) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () =>
        finish({
          commandId: id,
          success: false,
          confirmed: false,
          code: 'TIMEOUT',
          error: 'Command aborted.',
        });
      const timeout = setTimeout(
        () =>
          finish({
            commandId: id,
            success: false,
            confirmed: false,
            code: 'BRIDGE_OFFLINE',
            error: 'No bridge result was received before the command expired.',
          }),
        this.commandTimeoutMs,
      );
      this.pending.set(id, { command, resolve: finish, timeout });
      signal?.addEventListener('abort', onAbort, { once: true });
      const poller = this.pollers.get(bridgeId)?.values().next().value as
        ((command?: BridgeCommand) => void) | undefined;
      if (poller) poller(command);
      else this.enqueue(command);
    });
  }

  async poll(
    bridgeId: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<BridgeCommand | undefined> {
    const queued = this.dequeue(bridgeId);
    if (queued) return queued;
    return new Promise<BridgeCommand | undefined>((resolve) => {
      const pollers = this.pollers.get(bridgeId) ?? new Set();
      this.pollers.set(bridgeId, pollers);
      const finish = (command?: BridgeCommand) => {
        clearTimeout(timeout);
        pollers.delete(finish);
        signal?.removeEventListener('abort', onAbort);
        resolve(command);
      };
      const onAbort = () => finish();
      const timeout = setTimeout(() => finish(), waitMs);
      pollers.add(finish);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  complete(bridgeId: string, result: BridgeCommandResult): boolean {
    const pending = this.pending.get(result.commandId);
    if (!pending || pending.command.bridgeId !== bridgeId) return false;
    pending.resolve(result);
    return true;
  }

  close(): void {
    for (const { command, resolve } of this.pending.values())
      resolve({
        commandId: command.id,
        success: false,
        confirmed: false,
        code: 'BRIDGE_OFFLINE',
        error: 'Command broker stopped.',
      });
    for (const pollers of this.pollers.values()) for (const resolve of pollers) resolve();
    this.queues.clear();
    this.pollers.clear();
  }

  private enqueue(command: BridgeCommand): void {
    const queue = this.queues.get(command.bridgeId) ?? [];
    queue.push(command);
    this.queues.set(command.bridgeId, queue);
  }

  private dequeue(bridgeId: string): BridgeCommand | undefined {
    const queue = this.queues.get(bridgeId);
    while (queue?.length) {
      const command = queue.shift();
      if (command && this.pending.has(command.id)) return command;
    }
    return undefined;
  }
}

export class BridgeClimateProvider implements ClimateProvider {
  constructor(
    private readonly broker: DeviceCommandBroker,
    private readonly bridgeId: string,
  ) {}

  async execute(
    deviceId: string,
    operation: ClimateOperation,
    signal?: AbortSignal,
  ): Promise<ClimateResult> {
    const result = await this.broker.dispatch(this.bridgeId, deviceId, operation, signal);
    if (!result.success || !result.confirmed || !result.state || !result.state.online)
      return {
        ...failure(
          'bridge',
          deviceId,
          result.code ?? 'INVALID_RESPONSE',
          result.error ?? 'O bridge não confirmou o estado do ar-condicionado.',
          this.bridgeId,
          result.commandId,
        ),
        ...(result.state ? { state: result.state } : {}),
      };
    if (!operationMatchesState(operation, result.state))
      return {
        ...failure(
          'bridge',
          deviceId,
          'STATE_NOT_CONFIRMED',
          'O estado retornado não confirma o comando solicitado.',
          this.bridgeId,
          result.commandId,
        ),
        state: result.state,
      };
    return {
      success: true,
      confirmed: true,
      source: 'bridge',
      bridgeId: this.bridgeId,
      commandId: result.commandId,
      deviceId,
      state: result.state,
    };
  }
}

function operationMatchesState(operation: ClimateOperation, state: ClimateState): boolean {
  switch (operation.action) {
    case 'get_state':
      return state.online;
    case 'turn_on':
      return state.power;
    case 'turn_off':
      return !state.power;
    case 'set_temperature':
      return (
        state.power &&
        Math.abs(state.targetTemperatureCelsius - operation.temperatureCelsius) <= 0.25
      );
    case 'set_mode':
      return state.power && state.mode === operation.mode;
  }
}

const noArguments = z.object({});
const temperatureArguments = z.object({ temperatureCelsius: z.number().min(16).max(30) });
const modeArguments = z.object({ mode: z.enum(CLIMATE_MODES) });

export function createClimateTools(provider: ClimateProvider, deviceId: string): ToolDefinition[] {
  return [
    climateTool(
      'climate.get_state',
      'Get the real current climate device state.',
      noArguments,
      'READ',
      () => ({ action: 'get_state' }),
    ),
    climateTool(
      'climate.turn_on',
      'Turn on the climate device.',
      noArguments,
      'ACTION',
      () => ({ action: 'turn_on' }),
      () => 'Ligar o ar-condicionado.',
    ),
    climateTool(
      'climate.turn_off',
      'Turn off the climate device.',
      noArguments,
      'ACTION',
      () => ({ action: 'turn_off' }),
      () => 'Desligar o ar-condicionado.',
    ),
    climateTool(
      'climate.set_temperature',
      'Set the climate device target temperature in Celsius.',
      temperatureArguments,
      'ACTION',
      (input) => ({ action: 'set_temperature', temperatureCelsius: input.temperatureCelsius }),
      (input) => `Definir o ar-condicionado para ${input.temperatureCelsius} °C.`,
    ),
    climateTool(
      'climate.set_mode',
      'Set the climate device mode: auto, cool, dry, heat, or fan.',
      modeArguments,
      'ACTION',
      (input) => ({ action: 'set_mode', mode: input.mode }),
      (input) => `Definir o modo do ar-condicionado como ${input.mode}.`,
    ),
  ];

  function climateTool<TSchema extends z.ZodType>(
    name: string,
    description: string,
    inputSchema: TSchema,
    permission: 'READ' | 'ACTION',
    operation: (input: z.output<TSchema>) => ClimateOperation,
    confirmationDescription?: (input: z.output<TSchema>) => string,
  ): ToolDefinition<TSchema> {
    return {
      name,
      description,
      inputSchema,
      permission,
      ...(confirmationDescription ? { confirmationDescription } : {}),
      presentResult(result) {
        return presentClimateResult(name, result);
      },
      async execute(input, context) {
        const result = await provider.execute(deviceId, operation(input), context.signal);
        return result.success
          ? { success: true, data: result }
          : {
              success: false,
              error: result.error,
              code: result.code,
              data: result,
            };
      },
    };
  }
}

function presentClimateResult(name: string, result: ToolResult): string | undefined {
  if (!result.success)
    return name === 'climate.get_state'
      ? 'Não consegui consultar o ar-condicionado.'
      : 'Não consegui ajustar o ar-condicionado.';
  const climate = result.data as ClimateSuccess;
  const state = climate.state;
  switch (name) {
    case 'climate.get_state':
      return state.power
        ? `Ligado, ${spokenMode(state.mode)} em ${state.targetTemperatureCelsius} graus.`
        : `Desligado, ajustado para ${state.targetTemperatureCelsius} graus.`;
    case 'climate.set_temperature':
      return `Pronto, ${state.targetTemperatureCelsius} graus.`;
    case 'climate.set_mode':
      return `Pronto, modo ${spokenMode(state.mode)}.`;
    case 'climate.turn_on':
    case 'climate.turn_off':
      return 'Pronto.';
    default:
      return undefined;
  }
}

function spokenMode(mode: ClimateMode): string {
  switch (mode) {
    case 'auto':
      return 'automático';
    case 'cool':
      return 'resfriando';
    case 'dry':
      return 'desumidificando';
    case 'heat':
      return 'aquecendo';
    case 'fan':
      return 'ventilando';
  }
}

export const bridgeResultSchema = z
  .object({
    commandId: z.string().uuid(),
    success: z.boolean(),
    confirmed: z.boolean(),
    state: z
      .object({
        power: z.boolean(),
        targetTemperatureCelsius: z.number().min(10).max(40),
        mode: z.enum(CLIMATE_MODES),
        online: z.boolean(),
        indoorTemperatureCelsius: z.number().min(-50).max(100).optional(),
        outdoorTemperatureCelsius: z.number().min(-50).max(100).optional(),
      })
      .optional(),
    code: z
      .enum([
        'BRIDGE_OFFLINE',
        'DEVICE_OFFLINE',
        'TIMEOUT',
        'AUTHENTICATION_FAILED',
        'COMMAND_REJECTED',
        'INVALID_RESPONSE',
        'STATE_NOT_CONFIRMED',
        'UNKNOWN',
      ])
      .optional(),
    error: z.string().min(1).max(1_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.success && (!value.confirmed || !value.state))
      context.addIssue({
        code: 'custom',
        message: 'Successful bridge results require confirmed=true and a state readback.',
      });
    if (value.success && value.state && !value.state.online)
      context.addIssue({
        code: 'custom',
        message: 'Successful bridge results require online=true.',
      });
    if (!value.success && value.confirmed)
      context.addIssue({
        code: 'custom',
        message: 'Failed bridge results require confirmed=false.',
      });
    if (!value.success && !value.error)
      context.addIssue({ code: 'custom', message: 'Failed bridge results require an error.' });
  });

function failure(
  source: 'mock' | 'bridge',
  deviceId: string,
  code: ClimateFailure['code'],
  error: string,
  bridgeId?: string,
  commandId?: string,
): ClimateFailure {
  return {
    success: false,
    confirmed: false,
    source,
    deviceId,
    code,
    error,
    ...(bridgeId ? { bridgeId } : {}),
    ...(commandId ? { commandId } : {}),
  };
}
