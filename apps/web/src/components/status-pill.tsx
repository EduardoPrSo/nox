import { Circle } from 'lucide-react';
import type { ConnectorStatus } from '@/lib/types';

const statusContent: Record<ConnectorStatus, { label: string; tone: string }> = {
  NOT_CONNECTED: { label: 'Não conectado', tone: 'muted' },
  CONNECTING: { label: 'Conectando', tone: 'info' },
  WAITING_USER: { label: 'Aguardando você', tone: 'waiting' },
  CONNECTED: { label: 'Conectado', tone: 'success' },
  DEGRADED: { label: 'Atenção', tone: 'warning' },
  ERROR: { label: 'Erro', tone: 'danger' },
  REAUTH_REQUIRED: { label: 'Reconectar', tone: 'warning' },
};

export function StatusPill({ status }: { status: ConnectorStatus }) {
  const content = statusContent[status];
  return (
    <span className="status-pill" data-tone={content.tone}>
      <Circle aria-hidden="true" size={7} fill="currentColor" />
      {content.label}
    </span>
  );
}
