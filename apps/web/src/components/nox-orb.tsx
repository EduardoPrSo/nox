import type { OrbState } from '@/lib/types';

const stateLabels: Record<OrbState, string> = {
  IDLE: 'Pronto',
  LISTENING: 'Ouvindo',
  THINKING: 'Pensando',
  SPEAKING: 'Falando',
  EKO_ACTIVE: 'Eko ativo',
  ERROR: 'Precisa de atenção',
};

export function NoxOrb({
  state = 'IDLE',
  size = 'hero',
  label = true,
}: {
  state?: OrbState;
  size?: 'mini' | 'compact' | 'hero';
  label?: boolean;
}) {
  return (
    <div className={`orb-composition orb-${size}`} data-state={state.toLowerCase()}>
      <div className="orb-aura" aria-hidden="true" />
      <div className="orb-ring orb-ring-outer" aria-hidden="true" />
      <div className="orb-ring orb-ring-inner" aria-hidden="true" />
      <div className="orb-core" aria-hidden="true">
        <span className="orb-glint" />
      </div>
      <span className="sr-only">Estado do agente: {stateLabels[state]}</span>
      {label ? (
        <div className="orb-label" aria-hidden="true">
          <strong>NOX</strong>
          <span>{stateLabels[state]}</span>
        </div>
      ) : null}
    </div>
  );
}
