import Link from 'next/link';
import { ArrowUpRight, ChevronRight, Plus } from 'lucide-react';
import { mockConnections } from '@/lib/mock-data';
import { ConnectorGlyph } from './connector-glyph';
import { PageHeader } from './page-header';
import { StatusPill } from './status-pill';

export function ConnectionsGrid() {
  const connected = mockConnections.filter((connector) => connector.status !== 'NOT_CONNECTED');
  const available = mockConnections.filter((connector) => connector.status === 'NOT_CONNECTED');

  return (
    <div className="connections-page page-stack">
      <PageHeader
        eyebrow="Capacidades"
        title="Connections"
        description="Serviços que ampliam o que seu Nox consegue perceber e fazer — sempre sob suas permissões."
        action={
          <button className="secondary-button" type="button">
            <Plus aria-hidden="true" size={16} /> Sugerir conexão
          </button>
        }
      />

      <section className="connection-section" aria-labelledby="connected-title">
        <div className="section-heading-inline">
          <h2 id="connected-title">Suas conexões</h2>
          <span>{connected.length} configuradas</span>
        </div>
        <div className="connection-list">
          {connected.map((connector) => (
            <Link
              href={`/connections/${connector.id}`}
              className="connection-row"
              key={connector.id}
            >
              <ConnectorGlyph connector={connector} />
              <div className="connection-main">
                <strong>{connector.name}</strong>
                <span>{connector.displayAccount ?? connector.description}</span>
              </div>
              <div className="connection-capabilities">
                {connector.capabilities
                  .filter((capability) => capability.enabled)
                  .slice(0, 2)
                  .map((capability) => (
                    <span key={capability.id}>{capability.label}</span>
                  ))}
              </div>
              <StatusPill status={connector.status} />
              <ChevronRight aria-hidden="true" className="connection-chevron" size={18} />
            </Link>
          ))}
        </div>
      </section>

      <section className="connection-section" aria-labelledby="available-title">
        <div className="section-heading-inline">
          <h2 id="available-title">Disponíveis</h2>
          <span>Conecte quando precisar</span>
        </div>
        <div className="available-grid">
          {available.map((connector) => (
            <Link
              href={`/connections/${connector.id}`}
              className="available-connector"
              key={connector.id}
            >
              <ConnectorGlyph connector={connector} />
              <div>
                <strong>{connector.name}</strong>
                <p>{connector.description}</p>
              </div>
              <span className="connect-link">
                Conectar <ArrowUpRight aria-hidden="true" size={14} />
              </span>
            </Link>
          ))}
          <article className="available-connector available-connector-future">
            <span className="connector-glyph connector-glyph-muted">
              <Plus aria-hidden="true" size={21} />
            </span>
            <div>
              <strong>Mais em breve</strong>
              <p>Drive, Spotify, Home Assistant e outras extensões.</p>
            </div>
          </article>
        </div>
      </section>

      <aside className="connection-principle">
        <span>Connections ≠ permission</span>
        <p>
          Conectar um serviço não dá ao Nox liberdade irrestrita. Você decide o que ele pode
          consultar, quando deve perguntar e o que fica desativado.
        </p>
        <Link href="/settings#permissions">
          Revisar permissões <ArrowUpRight aria-hidden="true" size={14} />
        </Link>
      </aside>
    </div>
  );
}
