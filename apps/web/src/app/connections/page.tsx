import type { Metadata } from 'next';
import { ConnectionsGrid } from '@/components/connections-grid';

export const metadata: Metadata = { title: 'Connections' };

export default function ConnectionsPage() {
  return <ConnectionsGrid />;
}
