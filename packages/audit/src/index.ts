import { randomUUID } from 'node:crypto';
export type AuditEventType =
  | 'request'
  | 'memory_retrieval'
  | 'tool_requested'
  | 'permission'
  | 'confirmation_created'
  | 'confirmation_resolved'
  | 'tool_result'
  | 'error'
  | 'response';
export type AuditEvent = {
  id: string;
  requestId: string;
  userId: string;
  type: AuditEventType;
  timestamp: Date;
  durationMs?: number;
  data: unknown;
};
export interface AuditRepository {
  log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void>;
}
const sensitiveKey = /authorization|api[-_]?key|token|secret|password|cookie/i;
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : sanitize(child),
      ]),
    );
  return value;
}
export class InMemoryAuditRepository implements AuditRepository {
  readonly events: AuditEvent[] = [];
  async log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    this.events.push({
      ...event,
      id: randomUUID(),
      timestamp: new Date(),
      data: sanitize(event.data),
    });
  }
}
