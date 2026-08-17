import { WifiOff } from 'lucide-react';
import { NoxOrb } from '@/components/nox-orb';

export default function OfflinePage() {
  return (
    <div className="offline-page">
      <NoxOrb state="ERROR" size="compact" />
      <WifiOff aria-hidden="true" size={20} />
      <h1>Você está offline.</h1>
      <p>O shell do NOX está disponível, mas conversar com o agente precisa de conexão.</p>
      <a href="/">Tentar novamente</a>
    </div>
  );
}
