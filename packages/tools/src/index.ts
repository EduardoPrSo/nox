import { z } from 'zod';
import type { InteractionMode } from '@nox/ai';
import type { IdentityContext } from '@nox/identity';
import type { PermissionLevel } from '@nox/permissions';

export type ToolContext = IdentityContext & { requestId: string; signal: AbortSignal };
export type ToolResult =
  | { success: true; data: unknown }
  | { success: false; error: string; code?: string; data?: unknown };
export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: TSchema;
  permission: PermissionLevel;
  confirmationDescription?(input: z.output<TSchema>): string;
  presentResult?(result: ToolResult, interactionMode: InteractionMode): string | undefined;
  execute(input: z.output<TSchema>, context: ToolContext): Promise<ToolResult>;
}
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}
const defineTool = <TSchema extends z.ZodType>(
  tool: ToolDefinition<TSchema>,
): ToolDefinition<TSchema> => tool;

export function createMockTools(now: () => Date = () => new Date()): ToolDefinition[] {
  return [
    defineTool({
      name: 'get_current_time',
      description: 'Get the current date and time in an IANA timezone.',
      inputSchema: z.object({ timezone: z.string().default('America/Sao_Paulo') }),
      permission: 'READ',
      presentResult(result) {
        if (!result.success) return 'Não consegui consultar a hora.';
        const data = result.data as { iso?: unknown; timezone?: unknown };
        if (typeof data.iso !== 'string' || typeof data.timezone !== 'string') return undefined;
        try {
          const time = new Intl.DateTimeFormat('pt-BR', {
            timeZone: data.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(new Date(data.iso));
          return `São ${time}.`;
        } catch {
          return undefined;
        }
      },
      async execute(input) {
        return { success: true, data: { iso: now().toISOString(), timezone: input.timezone } };
      },
    }),
    defineTool({
      name: 'get_weather_mock',
      description: 'Get mocked weather for a city. This is not live weather.',
      inputSchema: z.object({ city: z.string().min(1).max(100) }),
      permission: 'READ',
      async execute(input) {
        return {
          success: true,
          data: { city: input.city, temperatureCelsius: 27, condition: 'clear', mock: true },
        };
      },
    }),
    defineTool({
      name: 'send_message_mock',
      description: 'Send a mocked message to a named recipient. No real message is sent.',
      inputSchema: z.object({
        recipient: z.string().min(1).max(100),
        message: z.string().min(1).max(2000),
      }),
      permission: 'EXTERNAL',
      confirmationDescription(input) {
        return `Enviar para ${input.recipient}: “${input.message}”`;
      },
      async execute(input) {
        return { success: true, data: { ...input, delivered: true, mock: true } };
      },
    }),
  ];
}
