'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Connector, ConnectorStatus } from '@/lib/types';
import { ConnectorGlyph } from './connector-glyph';
import { StatusPill } from './status-pill';

const qrPattern = [
  '1111111010101111111',
  '1000001011101000001',
  '1011101010101011101',
  '1011101001001011101',
  '1011101011101011101',
  '1000001000101000001',
  '1111111010101111111',
  '0000000011100000000',
  '1010111110011010101',
  '0111000011110101110',
  '1010111010011110011',
  '0101100101100011100',
  '1111111010111010101',
  '1000001011000011010',
  '1011101010111110111',
  '1011101001100100100',
  '1011101010111111101',
  '1000001001010001010',
  '1111111011101110111',
];

function MockQr() {
  return (
    <div
      className="mock-qr"
      role="img"
      aria-label="QR Code de demonstração; não contém credenciais reais"
    >
      {qrPattern.flatMap((row, rowIndex) =>
        [...row].map((cell, columnIndex) => (
          <i key={`${rowIndex}-${columnIndex}`} data-dark={cell === '1'} />
        )),
      )}
    </div>
  );
}

export function ConnectionDetail({ connector }: { connector: Connector }) {
  const [status, setStatus] = useState<ConnectorStatus>(connector.status);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (status !== 'CONNECTING') return;
    const timer = setTimeout(() => {
      setStatus('CONNECTED');
      setNotice(`${connector.name} conectado com sucesso.`);
    }, 1_500);
    return () => clearTimeout(timer);
  }, [connector.name, status]);

  const isWhatsapp = connector.id === 'whatsapp';
  const isGoogle = connector.id === 'google';

  return (
    <div className="connection-detail-page page-stack">
      <Link className="back-link" href="/connections">
        <ArrowLeft aria-hidden="true" size={16} /> Connections
      </Link>
      <header className="connector-detail-header">
        <ConnectorGlyph connector={connector} size="large" />
        <div>
          <p className="eyebrow">Connector</p>
          <h1>{connector.name}</h1>
          <p>{connector.description}</p>
        </div>
        <StatusPill status={status} />
      </header>

      {notice ? (
        <div className="inline-success" role="status">
          <Check aria-hidden="true" size={16} />
          {notice}
        </div>
      ) : null}

      {isWhatsapp && status !== 'CONNECTED' ? (
        <section className="qr-connect-panel">
          <div className="qr-copy">
            <p className="eyebrow">Conectar WhatsApp</p>
            <h2>Aponte a câmera para o QR</h2>
            <p>
              No WhatsApp, abra <strong>Dispositivos conectados</strong> e escolha{' '}
              <strong>Conectar dispositivo</strong>.
            </p>
            <ol>
              <li>Abra o WhatsApp no celular</li>
              <li>Toque em Dispositivos conectados</li>
              <li>Leia este QR Code</li>
            </ol>
            <div className="privacy-inline">
              <LockKeyhole aria-hidden="true" size={16} />
              <span>Credenciais e instance ID nunca chegam ao navegador.</span>
            </div>
          </div>
          <div className="qr-stage">
            <MockQr />
            <span className="waiting-indicator">
              <i /> Aguardando conexão…
            </span>
            <button className="mock-action" type="button" onClick={() => setStatus('CONNECTING')}>
              Simular leitura do QR
            </button>
            <small>Mock visual · não escaneável</small>
          </div>
        </section>
      ) : null}

      {isGoogle && status !== 'CONNECTED' ? (
        <section className="oauth-panel">
          <span className="connector-glyph" data-accent="sky" data-size="large">
            G
          </span>
          <p className="eyebrow">OAuth seguro</p>
          <h2>Conecte somente seu calendário</h2>
          <p>
            O Nox pedirá apenas acesso para visualizar e criar eventos. Gmail não faz parte desta
            autorização.
          </p>
          <button className="primary-button" type="button" onClick={() => setStatus('CONNECTING')}>
            {status === 'CONNECTING' ? (
              <LoaderCircle className="spin" aria-hidden="true" size={17} />
            ) : (
              <ExternalLink aria-hidden="true" size={16} />
            )}
            Continuar com Google
          </button>
        </section>
      ) : null}

      {status === 'CONNECTED' ? (
        <div className="connector-detail-grid">
          <section className="connector-account-panel">
            <p className="eyebrow">Conta conectada</p>
            <h2>{connector.displayAccount ?? 'Conta de demonstração'}</h2>
            <p>{connector.lastActivity ?? 'Conexão pronta para uso.'}</p>
            <div className="account-security-row">
              <ShieldCheck aria-hidden="true" size={17} />
              <span>Secrets protegidos no servidor</span>
            </div>
            <div className="connector-actions">
              <button type="button">
                <RefreshCw aria-hidden="true" size={15} /> Reconectar
              </button>
              <button
                className="danger-ghost"
                type="button"
                onClick={() => setStatus('NOT_CONNECTED')}
              >
                <Unplug aria-hidden="true" size={15} /> Desconectar
              </button>
            </div>
          </section>
          <section className="capability-panel">
            <div className="section-heading-inline">
              <div>
                <p className="eyebrow">Acesso concedido</p>
                <h2>Capabilities</h2>
              </div>
              <Link href="/settings#permissions">Gerenciar</Link>
            </div>
            <div className="capability-list">
              {connector.capabilities.map((capability) => (
                <div key={capability.id} className="capability-row">
                  <span className="capability-check" data-enabled={capability.enabled}>
                    {capability.enabled ? <Check aria-hidden="true" size={13} /> : null}
                  </span>
                  <div>
                    <strong>{capability.label}</strong>
                    <small>{capability.id}</small>
                  </div>
                  <span>{capability.enabled ? 'Ativo' : 'Desativado'}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <section className="connection-security-strip">
        <div>
          <KeyRound aria-hidden="true" size={18} />
          <span>
            <strong>Credenciais</strong>
            <small>Somente no servidor</small>
          </span>
        </div>
        <div>
          <Link2 aria-hidden="true" size={18} />
          <span>
            <strong>Ownership</strong>
            <small>Vinculado a esta conta</small>
          </span>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" size={18} />
          <span>
            <strong>Permissões</strong>
            <small>Configuradas por capability</small>
          </span>
        </div>
      </section>
    </div>
  );
}
