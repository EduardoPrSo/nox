import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConnectionDetail } from '@/components/connection-detail';
import { mockConnections } from '@/lib/mock-data';

export function generateStaticParams() {
  return mockConnections.map((connector) => ({ connector: connector.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ connector: string }>;
}): Promise<Metadata> {
  const { connector: connectorId } = await params;
  const connector = mockConnections.find((item) => item.id === connectorId);
  return { title: connector?.name ?? 'Connection' };
}

export default async function ConnectorPage({
  params,
}: {
  params: Promise<{ connector: string }>;
}) {
  const { connector: connectorId } = await params;
  const connector = mockConnections.find((item) => item.id === connectorId);
  if (!connector) notFound();
  return <ConnectionDetail connector={connector} />;
}
