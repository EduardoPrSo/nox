export type AutomationRule = {
  id: string;
  userId: string;
  trigger: unknown;
  conditions: unknown[];
  actions: unknown[];
  enabled: boolean;
};
export interface AutomationEngine {
  evaluate(event: unknown): Promise<void>;
}
