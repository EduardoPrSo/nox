import { CalendarDays, GitBranch, HousePlug, MessageCircleMore } from 'lucide-react';
import type { Connector } from '@/lib/types';

const icons = {
  whatsapp: MessageCircleMore,
  google: CalendarDays,
  github: GitBranch,
  climate: HousePlug,
};

export function ConnectorGlyph({
  connector,
  size = 'regular',
}: {
  connector: Connector;
  size?: 'regular' | 'large';
}) {
  const Icon = icons[connector.id];
  return (
    <span className="connector-glyph" data-accent={connector.accent} data-size={size}>
      <Icon aria-hidden="true" size={size === 'large' ? 28 : 21} strokeWidth={1.7} />
    </span>
  );
}
