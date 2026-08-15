export const permissionLevels = ['READ', 'ACTION', 'EXTERNAL'] as const;
export type PermissionLevel = (typeof permissionLevels)[number];
export type PermissionDecision = 'ALLOW' | 'DENY' | 'REQUIRE_CONFIRMATION';
export type PermissionContext = { userId: string; toolName: string; level: PermissionLevel };
export interface PermissionEngine {
  evaluate(context: PermissionContext): Promise<PermissionDecision>;
}

export class DefaultPermissionEngine implements PermissionEngine {
  constructor(
    private readonly options: { allowActionTools: boolean; deniedTools?: ReadonlySet<string> },
  ) {}
  async evaluate(context: PermissionContext): Promise<PermissionDecision> {
    if (this.options.deniedTools?.has(context.toolName)) return 'DENY';
    if (context.level === 'READ') return 'ALLOW';
    if (context.level === 'ACTION')
      return this.options.allowActionTools ? 'ALLOW' : 'REQUIRE_CONFIRMATION';
    return 'REQUIRE_CONFIRMATION';
  }
}
