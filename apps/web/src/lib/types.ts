export type OrbState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'EKO_ACTIVE' | 'ERROR';

export type ConnectorStatus =
  | 'NOT_CONNECTED'
  | 'CONNECTING'
  | 'WAITING_USER'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'ERROR'
  | 'REAUTH_REQUIRED';

export type Connector = {
  id: 'whatsapp' | 'google' | 'github' | 'climate';
  name: string;
  description: string;
  status: ConnectorStatus;
  displayAccount?: string;
  capabilities: Array<{ id: string; label: string; enabled: boolean }>;
  accent: 'emerald' | 'sky' | 'violet' | 'amber';
  lastActivity?: string;
};

export type AgentProfile = {
  name: string;
  ownerName: string;
  preferredLanguage: string;
  voice: string;
  responseStyle: 'Concise' | 'Balanced' | 'Detailed';
  timezone: string;
  modelPolicy: 'Economy' | 'Balanced' | 'Performance';
};

export type UsagePoint = { label: string; cost: number };
export type UsageBreakdown = {
  label: string;
  cost: number;
  requests: number;
  color: string;
};
