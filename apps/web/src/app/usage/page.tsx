import type { Metadata } from 'next';
import { UsageDashboard } from '@/components/usage-dashboard';

export const metadata: Metadata = { title: 'Usage' };

export default function UsagePage() {
  return <UsageDashboard />;
}
