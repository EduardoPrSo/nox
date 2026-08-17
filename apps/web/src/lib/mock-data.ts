import type { AgentProfile, Connector, UsageBreakdown, UsagePoint } from './types';

export const mockAgentProfile: AgentProfile = {
  name: 'Nox',
  ownerName: 'Eduardo',
  preferredLanguage: 'Português (Brasil)',
  voice: 'Dora',
  responseStyle: 'Concise',
  timezone: 'America/Sao_Paulo',
  modelPolicy: 'Balanced',
};

export const mockConnections: Connector[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Mensagens e contatos, sempre sob sua permissão.',
    status: 'WAITING_USER',
    displayAccount: '+55 41 •••••• 2481',
    accent: 'emerald',
    lastActivity: 'Aguardando leitura do QR',
    capabilities: [
      { id: 'messages.send', label: 'Enviar mensagens', enabled: true },
      { id: 'contacts.lookup', label: 'Localizar contatos', enabled: true },
      { id: 'messages.read', label: 'Ler mensagens', enabled: false },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Agenda e compromissos com acesso mínimo.',
    status: 'CONNECTED',
    displayAccount: 'eduardo@••••.com',
    accent: 'sky',
    lastActivity: 'Calendário consultado há 18 min',
    capabilities: [
      { id: 'calendar.read', label: 'Ver eventos', enabled: true },
      { id: 'calendar.write', label: 'Criar eventos', enabled: true },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositórios, issues e pull requests.',
    status: 'NOT_CONNECTED',
    accent: 'violet',
    capabilities: [
      { id: 'repositories.read', label: 'Ver repositórios', enabled: false },
      { id: 'issues.write', label: 'Gerenciar issues', enabled: false },
    ],
  },
  {
    id: 'climate',
    name: 'Smart Home',
    description: 'Bridge local e dispositivos de clima.',
    status: 'DEGRADED',
    displayAccount: 'Bridge casa · 3 dispositivos',
    accent: 'amber',
    lastActivity: 'Quarto offline há 7 min',
    capabilities: [
      { id: 'climate.read', label: 'Consultar clima', enabled: true },
      { id: 'climate.control', label: 'Controlar dispositivos', enabled: true },
    ],
  },
];

export const mockUsageTrend: UsagePoint[] = [
  { label: '12', cost: 0.42 },
  { label: '13', cost: 0.76 },
  { label: '14', cost: 0.54 },
  { label: '15', cost: 1.18 },
  { label: '16', cost: 0.82 },
  { label: '17', cost: 1.42 },
  { label: '18', cost: 1.12 },
];

export const mockCapabilityUsage: UsageBreakdown[] = [
  { label: 'Voice', cost: 2.11, requests: 38, color: '#9c8cff' },
  { label: 'Eko', cost: 1.78, requests: 124, color: '#5ee8c1' },
  { label: 'Chat', cost: 1.34, requests: 51, color: '#76b9ff' },
  { label: 'Coding', cost: 1.01, requests: 6, color: '#f6a66d' },
  { label: 'Memory', cost: 0.44, requests: 89, color: '#d997ff' },
  { label: 'Vision', cost: 0.19, requests: 3, color: '#ff8099' },
];

export const mockModelUsage = [
  { model: 'openai/gpt-5.6-luna', label: 'Luna', requests: 286, tokens: 184_920, cost: 3.42 },
  { model: 'openai/gpt-5.6-terra', label: 'Terra', requests: 22, tokens: 48_310, cost: 2.31 },
  { model: 'openai/gpt-5.6-sol', label: 'Sol', requests: 6, tokens: 21_840, cost: 1.14 },
];

export const mockActivity = [
  {
    title: 'Memória criada',
    detail: 'Foi mencionado um compromisso na sexta.',
    time: 'agora',
    tone: 'eko',
  },
  {
    title: 'Clima ajustado',
    detail: 'Quarto definido para 23 °C após confirmação.',
    time: '18 min',
    tone: 'action',
  },
  {
    title: 'Agenda consultada',
    detail: '3 eventos encontrados para amanhã.',
    time: '42 min',
    tone: 'read',
  },
];

export const mockConversations = [
  { id: 'daily', title: 'Hoje', preview: 'O que tenho na agenda?', active: true },
  { id: 'climate', title: 'Casa e clima', preview: 'O quarto ficou em 23 °C', active: false },
  {
    id: 'trip',
    title: 'Viagem de setembro',
    preview: 'Organizei os pontos principais',
    active: false,
  },
];
